import { useEffect, useMemo, useRef, useState } from 'react';
import { pickLocalDirectoryPath } from '../../prd-api.js';
import {
  buildDefaultCommitMessage,
  DEFAULT_SOURCE_TREE_SYNC_MODE,
  isValidMode,
  MODE_OPTIONS,
  readLocal,
  STORAGE_KEY_MODE,
  SOURCE_TREE_SYNC_ASSET_DIR_NAME,
  SOURCE_TREE_SYNC_MD_FILE_NAME,
  STORAGE_KEY_TARGET_DIR,
} from './source-tree-sync-shared.js';

const SOURCETREE_SETUP_DOC_URL = 'https://shoplazza.feishu.cn/wiki/WkWUwnaBvimChQkfryYcK1qVnSc';

function normalizeProgressPercent(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function SourceTreeSyncModal({
  open,
  syncing,
  currentTitle = '',
  onCancel,
  onConfirm,
}) {
  const [targetDir, setTargetDir] = useState(() => readLocal(STORAGE_KEY_TARGET_DIR));
  const [mode, setMode] = useState(() => {
    const storedMode = readLocal(STORAGE_KEY_MODE, DEFAULT_SOURCE_TREE_SYNC_MODE);
    return isValidMode(storedMode) ? storedMode : DEFAULT_SOURCE_TREE_SYNC_MODE;
  });
  const [commitMessage, setCommitMessage] = useState(() => buildDefaultCommitMessage(
    currentTitle,
  ));
  const [targetDirError, setTargetDirError] = useState('');
  const [commitMessageError, setCommitMessageError] = useState('');
  const [sourceTreeProgress, setSourceTreeProgress] = useState(null);
  const targetInputRef = useRef(null);
  const wantCommit = mode === 'commit' || mode === 'commit-and-push';

  useEffect(() => {
    setTimeout(() => {
      targetInputRef.current?.focus();
    }, 30);
  }, [open]);

  const sourceTreeStatusLabel = useMemo(() => {
    if (sourceTreeProgress?.status === 'failed') return '失败';
    if (sourceTreeProgress?.status === 'succeeded') return '已完成';
    if (syncing || sourceTreeProgress?.status === 'running') return '同步中';
    return wantCommit ? '已配置自动提交' : '仅镜像文件';
  }, [sourceTreeProgress?.status, syncing, wantCommit]);

  async function handlePickDirectory() {
    try {
      const result = await pickLocalDirectoryPath('请选择 SourceTree 目标目录');
      if (result.aborted) return;
      setTargetDir(result.path);
      setTargetDirError('');
    } catch (e) {
      if (e?.name === 'AbortError') return;
      setTargetDirError(e?.message || '选择目录失败');
    }
  }

  async function validateAndConfirm() {
    const dir = targetDir.trim();
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
    if (wantCommit && !msg) {
      setCommitMessageError('commit message 不能为空');
      hasError = true;
    } else {
      setCommitMessageError('');
    }
    if (hasError) return;
    try {
      window.localStorage.setItem(STORAGE_KEY_TARGET_DIR, dir);
      window.localStorage.setItem(STORAGE_KEY_MODE, mode);
    } catch { /* ignore */ }
    setSourceTreeProgress({
      status: 'running',
      percent: 4,
      message: '已开始准备 SourceTree 同步…',
    });
    await onConfirm?.({
      targetDir: dir,
      mode,
      commitMessage: msg,
      onProgress: setSourceTreeProgress,
    });
  }

  if (!open) return null;

  return (
    <div className="prd-modal-overlay" onClick={onCancel} role="presentation">
      <div className="prd-modal prd-modal--form prd-modal--wide" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">同步 SourceTree</div>
          <div className="prd-modal__desc">
            把「原生 MD」导出内容直接镜像到目标目录，固定输出
            {' '}
            <code>{SOURCE_TREE_SYNC_MD_FILE_NAME}</code>
            {' '}
            和
            {' '}
            <code>{SOURCE_TREE_SYNC_ASSET_DIR_NAME}/</code>
            ，支持自动 commit / push，
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
        <div className="prd-modal__section-actions" style={{ padding: '0 20px 12px' }}>
          <span className={`prd-modal__pill${wantCommit ? ' prd-modal__pill--success' : ''}`}>
            {sourceTreeStatusLabel}
          </span>
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
            <button
              type="button"
              className="prd-modal__btn prd-modal__btn--cancel"
              style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
              onClick={handlePickDirectory}
              disabled={syncing}
              title="打开系统目录选择器并回填完整路径"
            >
              选择目录
            </button>
          </div>
          <div className="prd-modal__hint">可手动填写绝对路径，也可直接用「选择目录」回填完整路径；如需自动 commit / push，该目录必须位于某个 git 仓库内。</div>
          {targetDirError ? <div className="prd-modal__error">{targetDirError}</div> : null}
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
          <div className="prd-modal__hint">
            同步时会直接覆盖目标目录下的 <code>{SOURCE_TREE_SYNC_MD_FILE_NAME}</code> 和 <code>{SOURCE_TREE_SYNC_ASSET_DIR_NAME}/</code>；push 失败不会回滚 commit，会把 git 原始报错返回给你。
          </div>
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
        {sourceTreeProgress ? (
          <div className="prd-modal__progress">
            <div className="prd-modal__progress-head">
              <span>SourceTree 同步进度</span>
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
