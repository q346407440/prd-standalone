import { useEffect, useRef, useState } from 'react';
import {
  buildDefaultCommitMessage,
  DEFAULT_SOURCE_TREE_SYNC_MODE,
  isValidMode,
  MODE_OPTIONS,
  readLocal,
  STORAGE_KEY_FOLDER_NAME,
  STORAGE_KEY_MODE,
  STORAGE_KEY_TARGET_DIR,
} from './source-tree-sync-shared.js';

const SOURCETREE_SETUP_DOC_URL = 'https://shoplazza.feishu.cn/wiki/WkWUwnaBvimChQkfryYcK1qVnSc';

export function SourceTreeSyncModal({
  open,
  syncing,
  defaultFolderName = '',
  onCancel,
  onConfirm,
}) {
  const [targetDir, setTargetDir] = useState(() => readLocal(STORAGE_KEY_TARGET_DIR));
  const [folderName, setFolderName] = useState(() => {
    const storedFolder = readLocal(STORAGE_KEY_FOLDER_NAME);
    return storedFolder || defaultFolderName || '';
  });
  const [mode, setMode] = useState(() => {
    const storedMode = readLocal(STORAGE_KEY_MODE, DEFAULT_SOURCE_TREE_SYNC_MODE);
    return isValidMode(storedMode) ? storedMode : DEFAULT_SOURCE_TREE_SYNC_MODE;
  });
  const [commitMessage, setCommitMessage] = useState(() => buildDefaultCommitMessage(
    readLocal(STORAGE_KEY_FOLDER_NAME) || defaultFolderName,
  ));
  const [targetDirError, setTargetDirError] = useState('');
  const [folderNameError, setFolderNameError] = useState('');
  const [commitMessageError, setCommitMessageError] = useState('');
  const [supportsPicker] = useState(
    () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  );
  const targetInputRef = useRef(null);

  useEffect(() => {
    setTimeout(() => {
      targetInputRef.current?.focus();
    }, 30);
  }, []);

  async function handlePickDirectory() {
    if (!window.showDirectoryPicker) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setTargetDir((prev) => {
        if (prev && prev.endsWith(handle.name)) return prev;
        return prev ? `${prev.replace(/\/+$/, '')}/${handle.name}` : handle.name;
      });
      setTargetDirError('请补全为绝对路径（浏览器无法直接拿到目录的绝对路径）');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setTargetDirError(e?.message || '选择目录失败');
    }
  }

  function validateAndConfirm() {
    const dir = targetDir.trim();
    const name = folderName.trim();
    const msg = commitMessage.trim();
    const wantCommit = mode === 'commit' || mode === 'commit-and-push';
    let hasError = false;
    if (!dir) {
      setTargetDirError('请填写目标目录的绝对路径');
      hasError = true;
    } else if (!dir.startsWith('/')) {
      setTargetDirError('目标目录必须是绝对路径（macOS/Linux 以 / 开头）');
      hasError = true;
    } else {
      setTargetDirError('');
    }
    if (!name) {
      setFolderNameError('请填写子文件夹名称');
      hasError = true;
    } else if (/[\\/]/.test(name) || name === '.' || name === '..') {
      setFolderNameError('子文件夹名称不能包含 / \\ 或为 . / ..');
      hasError = true;
    } else {
      setFolderNameError('');
    }
    if (wantCommit && !msg) {
      setCommitMessageError('commit message 不能为空');
      hasError = true;
    } else {
      setCommitMessageError('');
    }
    if (hasError) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_TARGET_DIR, dir);
      window.localStorage.setItem(STORAGE_KEY_FOLDER_NAME, name);
      window.localStorage.setItem(STORAGE_KEY_MODE, mode);
    } catch { /* ignore */ }
    onConfirm?.({ targetDir: dir, folderName: name, mode, commitMessage: msg });
  }

  if (!open) return null;
  const wantCommit = mode === 'commit' || mode === 'commit-and-push';

  return (
    <div className="prd-modal-overlay" onClick={onCancel} role="presentation">
      <div className="prd-modal prd-modal--form prd-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">同步 SourceTree</div>
          <div className="prd-modal__desc">
            把「原生 MD」导出内容镜像到本地 Git 工作区的指定子文件夹，支持自动 commit / push，
            底层通过系统的 <code>git</code> 命令执行，依赖你本机已配置好的 SSH key（ssh-agent）。
            <br />
            首次使用前请先确认本机已完成 SourceTree / Git / SSH 相关配置；如遇报错，可先查看
            {' '}
            <a
              className="prd-modal__link"
              href={SOURCETREE_SETUP_DOC_URL}
              target="_blank"
              rel="noreferrer"
            >
              开发提供的配置文档
            </a>
            。
          </div>
        </div>
        <div className="prd-modal__body">
        <div className="prd-modal__field">
          <label className="prd-modal__label" htmlFor="prd-sync-target-dir">目标目录（绝对路径）</label>
          <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
            <input
              id="prd-sync-target-dir"
              ref={targetInputRef}
              className="prd-modal__input"
              style={{ flex: 1, minWidth: 0 }}
              value={targetDir}
              placeholder="/Users/you/code/your-repo"
              onChange={(e) => { setTargetDir(e.target.value); setTargetDirError(''); }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') { e.preventDefault(); validateAndConfirm(); }
                if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
              }}
              disabled={syncing}
            />
            {supportsPicker ? (
              <button
                type="button"
                className="prd-modal__btn prd-modal__btn--cancel"
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                onClick={handlePickDirectory}
                disabled={syncing}
                title="浏览器只能取到目录名，选完后需要你把绝对路径补全"
              >
                选择目录
              </button>
            ) : null}
          </div>
          <div className="prd-modal__hint">该目录必须是已 clone 的 git 仓库（或其父目录）。{supportsPicker ? '「选择目录」仅辅助回填目录名，仍需人工补全绝对路径前缀。' : ''}</div>
          {targetDirError ? <div className="prd-modal__error">{targetDirError}</div> : null}
        </div>
        <div className="prd-modal__field">
          <label className="prd-modal__label" htmlFor="prd-sync-folder-name">子文件夹名称</label>
          <input
            id="prd-sync-folder-name"
            className="prd-modal__input"
            value={folderName}
            placeholder="例如：prd-docs"
            onChange={(e) => { setFolderName(e.target.value); setFolderNameError(''); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); validateAndConfirm(); }
              if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
            }}
            disabled={syncing}
          />
          <div className="prd-modal__hint">同步内容将写入「目标目录 / 子文件夹」，已存在则直接镜像更新。</div>
          {folderNameError ? <div className="prd-modal__error">{folderNameError}</div> : null}
        </div>
        <div className="prd-modal__field">
          <div className="prd-modal__label" id="prd-sync-mode-label">执行方式</div>
          <div className="prd-modal__choice-group" role="radiogroup" aria-labelledby="prd-sync-mode-label">
            {MODE_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={`prd-modal__choice${mode === o.value ? ' prd-modal__choice--active' : ''}`}
                role="radio"
                aria-checked={mode === o.value}
                onClick={() => setMode(o.value)}
                disabled={syncing}
              >
                <span className="prd-modal__choice-title">{o.label}</span>
                <span className="prd-modal__choice-desc">{o.desc}</span>
              </button>
            ))}
          </div>
          <div className="prd-modal__hint">push 失败不会回滚 commit，会把 git 原始报错返回给你。</div>
        </div>
        {wantCommit ? (
          <div className="prd-modal__field">
            <label className="prd-modal__label" htmlFor="prd-sync-commit-msg">Commit message</label>
            <textarea
              id="prd-sync-commit-msg"
              className="prd-modal__textarea"
              value={commitMessage}
              onChange={(e) => { setCommitMessage(e.target.value); setCommitMessageError(''); }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  e.preventDefault();
                  validateAndConfirm();
                }
                if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
              }}
              placeholder="支持多行；可手动拖拽拉高"
              disabled={syncing}
            />
            <div className="prd-modal__hint">支持多行。默认自动拼「同步 PRD：&lt;文档名&gt; &lt;时间&gt;」，可随时改；按 `Cmd/Ctrl + Enter` 可直接提交。</div>
            {commitMessageError ? <div className="prd-modal__error">{commitMessageError}</div> : null}
          </div>
        ) : null}
        </div>
        <div className="prd-modal__actions">
          <button
            type="button"
            className="prd-modal__btn prd-modal__btn--cancel"
            onClick={onCancel}
            disabled={syncing}
          >取消</button>
          <button
            type="button"
            className="prd-modal__btn prd-modal__btn--primary"
            onClick={validateAndConfirm}
            disabled={syncing}
          >
            {syncing ? '同步中…' : '确认同步'}
          </button>
        </div>
      </div>
    </div>
  );
}
