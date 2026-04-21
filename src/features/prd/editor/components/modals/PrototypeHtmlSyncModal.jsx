import { useEffect, useMemo, useRef, useState } from 'react';
import { pickLocalDirectoryPath, readPrototypeHtmlDirectory } from '../../prd-api.js';
import {
  buildDefaultCommitMessage,
  DEFAULT_SOURCE_TREE_SYNC_MODE,
  isValidMode,
  MODE_OPTIONS,
  readLocal,
  STORAGE_KEY_MODE,
  STORAGE_KEY_TARGET_DIR,
  PROTOTYPE_HTML_SYNC_ASSET_DIR_NAME,
  PROTOTYPE_HTML_SYNC_FILE_NAME,
} from './source-tree-sync-shared.js';

const SOURCETREE_SETUP_DOC_URL = 'https://shoplazza.feishu.cn/wiki/WkWUwnaBvimChQkfryYcK1qVnSc';

function normalizeProgressPercent(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function PrototypeHtmlSyncModal({
  open,
  syncing,
  currentTitle = '',
  onCancel,
  onConfirm,
}) {
  const [sourceDir, setSourceDir] = useState('');
  const [targetDir, setTargetDir] = useState(() => readLocal(STORAGE_KEY_TARGET_DIR));
  const [mode, setMode] = useState(() => {
    const storedMode = readLocal(STORAGE_KEY_MODE, DEFAULT_SOURCE_TREE_SYNC_MODE);
    return isValidMode(storedMode) ? storedMode : DEFAULT_SOURCE_TREE_SYNC_MODE;
  });
  const [commitMessage, setCommitMessage] = useState(() => buildDefaultCommitMessage(
    currentTitle,
    '同步原型 HTML',
  ));
  const [sourceDirError, setSourceDirError] = useState('');
  const [targetDirError, setTargetDirError] = useState('');
  const [commitMessageError, setCommitMessageError] = useState('');
  const [sourceTreeProgress, setSourceTreeProgress] = useState(null);
  const sourceInputRef = useRef(null);
  const targetInputRef = useRef(null);
  const wantCommit = mode === 'commit' || mode === 'commit-and-push';

  useEffect(() => {
    if (!open) return;
    setTimeout(() => {
      sourceInputRef.current?.focus();
    }, 30);
  }, [open]);

  const sourceTreeStatusLabel = useMemo(() => {
    if (sourceTreeProgress?.status === 'failed') return '失败';
    if (sourceTreeProgress?.status === 'succeeded') return '已完成';
    if (syncing || sourceTreeProgress?.status === 'running') return '同步中';
    return wantCommit ? '已配置自动提交' : '仅镜像文件';
  }, [sourceTreeProgress?.status, syncing, wantCommit]);

  async function handlePickSourceDirectory() {
    try {
      const result = await pickLocalDirectoryPath('请选择原型 HTML 文件夹');
      if (result.aborted) return;
      setSourceDir(result.path);
      setSourceDirError('');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setSourceDirError(error?.message || '选择原型 HTML 文件夹失败');
    }
  }

  async function handlePickTargetDirectory() {
    try {
      const result = await pickLocalDirectoryPath('请选择原型 HTML 的目标目录');
      if (result.aborted) return;
      setTargetDir(result.path);
      setTargetDirError('');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setTargetDirError(error?.message || '选择目录失败');
    }
  }

  async function validateAndConfirm() {
    const source = sourceDir.trim();
    const dir = targetDir.trim();
    const msg = commitMessage.trim();
    let hasError = false;
    if (!source) {
      setSourceDirError('请填写原型 HTML 文件夹的绝对路径');
      hasError = true;
    } else if (!source.startsWith('/')) {
      setSourceDirError('原型 HTML 文件夹必须是绝对路径（macOS/Linux 以 / 开头）');
      hasError = true;
    } else {
      setSourceDirError('');
    }
    if (!dir) {
      setTargetDirError('请填写目标目录的绝对路径');
      hasError = true;
    } else if (!dir.startsWith('/')) {
      setTargetDirError('目标目录必须是绝对路径（macOS/Linux 以 / 开头）');
      hasError = true;
    } else {
      setTargetDirError('');
    }
    if (wantCommit && !msg) {
      setCommitMessageError('commit message 不能为空');
      hasError = true;
    } else {
      setCommitMessageError('');
    }
    if (hasError) return;

    try {
      setSourceTreeProgress({
        status: 'running',
        percent: 8,
        message: '正在读取原型 HTML 文件夹…',
      });
      const payload = await readPrototypeHtmlDirectory(source);
      try {
        window.localStorage.setItem(STORAGE_KEY_TARGET_DIR, dir);
        window.localStorage.setItem(STORAGE_KEY_MODE, mode);
      } catch {
        // Ignore storage failures and continue syncing.
      }
      await onConfirm?.({
        targetDir: dir,
        mode,
        commitMessage: msg,
        onProgress: setSourceTreeProgress,
        entries: payload.entries,
        sourceLabel: payload.sourceLabel || currentTitle,
      });
    } catch (error) {
      setSourceTreeProgress({
        status: 'failed',
        percent: 100,
        message: error?.message || '读取原型 HTML 文件夹失败',
      });
      setSourceDirError(error?.message || '读取原型 HTML 文件夹失败');
    }
  }

  if (!open) return null;

  return (
    <div className="prd-modal-overlay" onClick={onCancel} role="presentation">
      <div className="prd-modal prd-modal--form prd-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">同步原型 HTML</div>
          <div className="prd-modal__desc">
            选择原型 HTML 文件夹后，会把其中的
            {' '}
            <code>{PROTOTYPE_HTML_SYNC_FILE_NAME}</code>
            {' '}
            和
            {' '}
            <code>{PROTOTYPE_HTML_SYNC_ASSET_DIR_NAME}/</code>
            {' '}
            直接镜像到目标目录，支持自动 commit / push。
            <br />
            同步仍通过系统的 <code>git</code> 命令执行；如遇报错，可先查看
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
            <label className="prd-modal__label" htmlFor="prd-prototype-sync-source-dir">原型 HTML 文件夹（绝对路径）</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                id="prd-prototype-sync-source-dir"
                ref={sourceInputRef}
                className="prd-modal__input"
                style={{ flex: 1, minWidth: 0 }}
                value={sourceDir}
                placeholder="/Users/you/demo/loyalty-demo-html"
                onChange={(e) => { setSourceDir(e.target.value); setSourceDirError(''); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); validateAndConfirm(); }
                  if (e.key === 'Escape') { e.preventDefault(); onCancel?.(); }
                }}
                disabled={syncing}
              />
              <button
                type="button"
                className="prd-modal__btn prd-modal__btn--cancel"
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                onClick={handlePickSourceDirectory}
                disabled={syncing}
                title="打开系统目录选择器并回填完整路径"
              >
                选择文件夹
              </button>
            </div>
            <div className="prd-modal__hint">
              可手动填写绝对路径，也可直接用「选择文件夹」回填完整路径。请选择包含 <code>{PROTOTYPE_HTML_SYNC_FILE_NAME}</code> 的文件夹；如果目录里有 <code>{PROTOTYPE_HTML_SYNC_ASSET_DIR_NAME}/</code>，会一起同步。
            </div>
            {sourceDirError ? <div className="prd-modal__error">{sourceDirError}</div> : null}
          </div>

          <div className="prd-modal__field">
            <label className="prd-modal__label" htmlFor="prd-prototype-sync-target-dir">目标目录（绝对路径）</label>
            <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
              <input
                id="prd-prototype-sync-target-dir"
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
              <button
                type="button"
                className="prd-modal__btn prd-modal__btn--cancel"
                style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                onClick={handlePickTargetDirectory}
                disabled={syncing}
                title="打开系统目录选择器并回填完整路径"
              >
                选择目录
              </button>
            </div>
            <div className="prd-modal__hint">
              可手动填写绝对路径，也可直接用「选择目录」回填完整路径；如需自动 commit / push，该目录必须位于某个 git 仓库内。
            </div>
            {targetDirError ? <div className="prd-modal__error">{targetDirError}</div> : null}
          </div>

          <div className="prd-modal__field">
            <div className="prd-modal__section-head">
              <div className="prd-modal__label" id="prd-prototype-sync-mode-label">执行方式</div>
              <div className="prd-modal__section-actions">
                <span className={`prd-modal__pill${wantCommit ? ' prd-modal__pill--success' : ''}`}>
                  {sourceTreeStatusLabel}
                </span>
              </div>
            </div>
            <div className="prd-modal__choice-group" role="radiogroup" aria-labelledby="prd-prototype-sync-mode-label">
              {MODE_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  type="button"
                  className={`prd-modal__choice${mode === option.value ? ' prd-modal__choice--active' : ''}`}
                  role="radio"
                  aria-checked={mode === option.value}
                  onClick={() => setMode(option.value)}
                  disabled={syncing}
                >
                  <span className="prd-modal__choice-title">{option.label}</span>
                  <span className="prd-modal__choice-desc">{option.desc}</span>
                </button>
              ))}
            </div>
            <div className="prd-modal__hint">
              同步时会直接覆盖目标目录下的 <code>{PROTOTYPE_HTML_SYNC_FILE_NAME}</code> 和 <code>{PROTOTYPE_HTML_SYNC_ASSET_DIR_NAME}/</code>；push 失败不会回滚 commit，会把 git 原始报错返回给你。
            </div>
          </div>

          {wantCommit ? (
            <div className="prd-modal__field">
              <label className="prd-modal__label" htmlFor="prd-prototype-sync-commit-msg">Commit message</label>
              <textarea
                id="prd-prototype-sync-commit-msg"
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
              <div className="prd-modal__hint">默认自动生成提交说明，你也可以按需改成更具体的描述。</div>
              {commitMessageError ? <div className="prd-modal__error">{commitMessageError}</div> : null}
            </div>
          ) : null}

          {sourceTreeProgress ? (
            <div className="prd-modal__progress">
              <div className="prd-modal__progress-head">
                <span>原型 HTML 同步进度</span>
                <span>{normalizeProgressPercent(sourceTreeProgress.percent)}%</span>
              </div>
              <div className="prd-modal__progress-track">
                <div
                  className={`prd-modal__progress-bar${
                    sourceTreeProgress.status === 'failed'
                      ? ' prd-modal__progress-bar--error'
                      : sourceTreeProgress.status === 'succeeded'
                        ? ' prd-modal__progress-bar--success'
                        : ''
                  }`}
                  style={{ width: `${normalizeProgressPercent(sourceTreeProgress.percent)}%` }}
                />
              </div>
              <div
                className={`prd-modal__progress-text${
                  sourceTreeProgress.status === 'failed' ? ' prd-modal__progress-text--error' : ''
                }`}
              >
                {sourceTreeProgress.message}
              </div>
            </div>
          ) : null}
        </div>

        <div className="prd-modal__actions">
          <button
            type="button"
            className="prd-modal__btn prd-modal__btn--cancel"
            onClick={onCancel}
            disabled={syncing}
          >
            取消
          </button>
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
