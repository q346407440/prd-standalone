import { useMemo, useState } from 'react';
import {
  FiCheckSquare,
  FiExternalLink,
  FiGitBranch,
  FiRefreshCw,
  FiSend,
  FiSettings,
} from 'react-icons/fi';
import { emitPrdToast } from '../../prd-toast.js';
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

function buildPrimaryLabel({ useFeishu, useSourceTree, submitting }) {
  if (submitting) return '同步中…';
  if (useFeishu && useSourceTree) return '开始同步到飞书 + SourceTree';
  if (useFeishu) return '开始同步到飞书';
  if (useSourceTree) return '开始同步到 SourceTree';
  return '请选择同步目标';
}

function normalizeProgressPercent(value, fallback = 0) {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.max(0, Math.min(100, Math.round(value)));
}

export function CombinedSyncModal({
  open,
  onCancel,
  currentTitle = '',
  defaultFolderName = '',
  onSyncSourceTree,
  syncingSourceTree = false,
  feishuController,
  onOpenFeishuAdvanced,
  onOpenSourceTreeAdvanced,
}) {
  const [useFeishu, setUseFeishu] = useState(true);
  const [useSourceTree, setUseSourceTree] = useState(true);
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
  const [selectionError, setSelectionError] = useState('');
  const [feishuError, setFeishuError] = useState('');
  const [targetDirError, setTargetDirError] = useState('');
  const [folderNameError, setFolderNameError] = useState('');
  const [commitMessageError, setCommitMessageError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [sourceTreeProgress, setSourceTreeProgress] = useState(null);
  const [supportsPicker] = useState(
    () => typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function',
  );

  async function handlePickDirectory() {
    if (!window.showDirectoryPicker) return;
    try {
      const handle = await window.showDirectoryPicker({ mode: 'read' });
      setTargetDir((prev) => {
        if (prev && prev.endsWith(handle.name)) return prev;
        return prev ? `${prev.replace(/\/+$/, '')}/${handle.name}` : handle.name;
      });
      setTargetDirError('浏览器只能拿到目录名；请在 mac 的 Finder 中选中文件夹后按 Option + Command + C，复制完整路径并粘贴到这里');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      setTargetDirError(error?.message || '选择目录失败');
    }
  }

  const {
    status,
    statusError,
    docUrl,
    setDocUrl,
    refreshStatus,
    startAuth,
    logout,
    startSync,
    isSyncing: feishuSyncing,
    syncSubmitting: feishuSubmitting,
    summaryTitle,
    phaseLabel,
    job,
  } = feishuController;

  const wantCommit = mode === 'commit' || mode === 'commit-and-push';
  const busy = submitting || syncingSourceTree || feishuSyncing || feishuSubmitting;

  const feishuProgress = useMemo(() => {
    if (!job) return null;
    return {
      status: job.status === 'failed' ? 'failed' : job.status === 'succeeded' ? 'succeeded' : 'running',
      percent: normalizeProgressPercent(
        job.status === 'succeeded' || job.status === 'failed' ? 100 : job.percent,
        job.status === 'queued' ? 0 : 0,
      ),
      message: job.error || job.message || phaseLabel || '正在同步飞书…',
    };
  }, [job, phaseLabel]);

  const sourceTreeStatusLabel = useMemo(() => {
    if (sourceTreeProgress?.status === 'failed') return '失败';
    if (sourceTreeProgress?.status === 'succeeded') return '已完成';
    if (syncingSourceTree || sourceTreeProgress?.status === 'running') return '同步中';
    return wantCommit ? '已配置自动提交' : '仅镜像文件';
  }, [sourceTreeProgress?.status, syncingSourceTree, wantCommit]);

  const feishuStatusLabel = useMemo(() => {
    if (!status.configured) return '未配置';
    if (job?.status === 'failed') return '失败';
    if (job?.status === 'succeeded') return '已完成';
    if (feishuSyncing || feishuSubmitting) return '同步中';
    if (status.authenticated) return '已连接';
    return '未连接';
  }, [feishuSubmitting, feishuSyncing, job?.status, status.authenticated, status.configured]);

  if (!open) return null;

  function openFeishuAdvanced() {
    if (busy) return;
    onCancel?.();
    onOpenFeishuAdvanced?.();
  }

  function openSourceTreeAdvanced() {
    if (busy) return;
    onCancel?.();
    onOpenSourceTreeAdvanced?.();
  }

  function validateForm() {
    let hasError = false;
    if (!useFeishu && !useSourceTree) {
      setSelectionError('请至少勾选一个同步目标');
      hasError = true;
    } else {
      setSelectionError('');
    }

    if (useFeishu) {
      if (!status.authenticated) {
        setFeishuError('请先连接飞书账号');
        hasError = true;
      } else if (!docUrl.trim()) {
        setFeishuError('请填写目标飞书文档链接');
        hasError = true;
      } else {
        setFeishuError('');
      }
    } else {
      setFeishuError('');
    }

    if (useSourceTree) {
      const dir = targetDir.trim();
      const name = folderName.trim();
      const msg = commitMessage.trim();
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
    } else {
      setTargetDirError('');
      setFolderNameError('');
      setCommitMessageError('');
    }
    return !hasError;
  }

  async function handleConfirm() {
    if (busy) return;
    if (!validateForm()) return;
    if (useSourceTree) {
      try {
        window.localStorage.setItem(STORAGE_KEY_TARGET_DIR, targetDir.trim());
        window.localStorage.setItem(STORAGE_KEY_FOLDER_NAME, folderName.trim());
        window.localStorage.setItem(STORAGE_KEY_MODE, mode);
      } catch { /* ignore */ }
    }
    setSubmitting(true);
    const results = [];
    try {
      if (useFeishu) {
        const feishuResult = await startSync({ waitForCompletion: true, silent: true });
        results.push({
          key: 'feishu',
          label: '飞书',
          ok: feishuResult?.ok !== false,
          message: feishuResult?.error?.message || feishuResult?.job?.error || '',
        });
      }

      if (useSourceTree) {
        try {
          setSourceTreeProgress({
            status: 'running',
            percent: 4,
            message: '已开始准备 SourceTree 同步…',
          });
          const sourceTreeResult = await onSyncSourceTree?.({
            currentTitle,
            targetDir: targetDir.trim(),
            folderName: folderName.trim(),
            mode,
            commitMessage: commitMessage.trim(),
            silent: true,
            onProgress: setSourceTreeProgress,
          });
          results.push({
            key: 'sourcetree',
            label: 'SourceTree',
            ok: !(sourceTreeResult === false || sourceTreeResult?.ok === false),
            message: sourceTreeResult?.message || sourceTreeResult?.error || '',
          });
        } catch (error) {
          results.push({
            key: 'sourcetree',
            label: 'SourceTree',
            ok: false,
            message: error?.message || '同步 SourceTree 失败',
          });
          setSourceTreeProgress({
            status: 'failed',
            percent: 100,
            message: error?.message || '同步 SourceTree 失败',
          });
        }
      }

      const succeeded = results.filter((item) => item.ok);
      const failed = results.filter((item) => !item.ok);

      if (failed.length === 0) {
        const successLabel = succeeded.map((item) => item.label).join(' + ');
        emitPrdToast(`已完成同步：${successLabel}`, { tone: 'success', duration: 3200 });
        return;
      }

      const failedLabel = failed.map((item) => item.label).join('、');
      const failedMessage = failed.map((item) => item.message).filter(Boolean).join('；');
      emitPrdToast(
        succeeded.length
          ? `部分同步成功：${failedLabel} 失败${failedMessage ? `，${failedMessage}` : ''}`
          : `同步失败：${failedMessage || failedLabel}`,
        { tone: succeeded.length ? 'warning' : 'error', duration: 4200 },
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="prd-modal-overlay" onClick={busy ? undefined : onCancel} role="presentation">
      <div className="prd-modal prd-modal--form prd-modal--wide" onClick={(event) => event.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">同步</div>
          <div className="prd-modal__desc">
            默认支持一键同时同步到飞书和 SourceTree。只想同步一边时，取消另一边的勾选即可；
            如果需要完整配置说明或更详细的进度区，可进入各自的高级配置弹窗。
          </div>
        </div>

        <div className="prd-modal__body">
        <div className="prd-modal__field">
          <div className="prd-modal__section-head">
            <label className="prd-modal__check">
              <input
                type="checkbox"
                checked={useFeishu}
                onChange={(event) => {
                  setUseFeishu(event.target.checked);
                  setSelectionError('');
                  setFeishuError('');
                }}
                disabled={busy}
              />
              <span className="prd-modal__check-label">
                <FiSend className="prd-modal__check-icon" />
                <span>同步飞书</span>
              </span>
            </label>
            <div className="prd-modal__section-actions">
              <span className={`prd-modal__pill${status.authenticated ? ' prd-modal__pill--success' : ''}`}>
                {feishuStatusLabel}
              </span>
              <button type="button" className="prd-modal__link-btn" onClick={() => void refreshStatus()} disabled={busy}>
                <FiRefreshCw />
                <span>刷新</span>
              </button>
              <button type="button" className="prd-modal__link-btn" onClick={openFeishuAdvanced} disabled={busy}>
                <FiSettings />
                <span>高级配置</span>
              </button>
            </div>
          </div>
          {useFeishu ? (
            <div className="prd-modal__section-card">
              <div className="prd-modal__status-line">
                <div className="prd-modal__status-text">
                  {!status.configured
                    ? '当前环境还未配置飞书同步所需参数。'
                    : status.authenticated
                      ? `当前已连接 ${status.user?.name || '飞书账号'}。`
                      : '当前尚未连接飞书账号。'}
                </div>
                {!status.authenticated ? (
                  <button
                    type="button"
                    className="prd-modal__btn prd-modal__btn--primary"
                    onClick={startAuth}
                    disabled={!status.configured || busy}
                  >
                    连接飞书
                  </button>
                ) : (
                  <button
                    type="button"
                    className="prd-modal__btn prd-modal__btn--cancel"
                    onClick={() => void logout()}
                    disabled={busy}
                  >
                    清除授权
                  </button>
                )}
              </div>
              <div className="prd-modal__field">
                <div className="prd-modal__section-subhead">
                  <span>目标文档</span>
                  <a className="prd-modal__link" href="https://open.feishu.cn/" target="_blank" rel="noreferrer">
                    <FiExternalLink />
                    <span>开放平台</span>
                  </a>
                </div>
                <input
                  className="prd-modal__input"
                  value={docUrl}
                  onChange={(event) => {
                    setDocUrl(event.target.value);
                    setFeishuError('');
                  }}
                  placeholder="粘贴飞书 docx / wiki 链接"
                  disabled={busy}
                />
                <div className="prd-modal__hint">
                  当前来源：<code>{summaryTitle}</code>
                  。只有继续同步同一份 PRD 到同一目标文档时，才会走增量更新。
                  {job?.status ? ` 当前进度：${phaseLabel}` : ''}
                </div>
                {status.redirectUri ? (
                  <div className="prd-modal__hint">回调地址：<code>{status.redirectUri}</code></div>
                ) : null}
                {statusError ? <div className="prd-modal__error">{statusError}</div> : null}
                {feishuError ? <div className="prd-modal__error">{feishuError}</div> : null}
              </div>
              {feishuProgress ? (
                <div className="prd-modal__progress">
                  <div className="prd-modal__progress-head">
                    <span>飞书同步进度</span>
                    <span>{feishuProgress.percent}%</span>
                  </div>
                  <div className="prd-modal__progress-track">
                    <div
                      className={`prd-modal__progress-bar${
                        feishuProgress.status === 'failed'
                          ? ' prd-modal__progress-bar--error'
                          : feishuProgress.status === 'succeeded'
                            ? ' prd-modal__progress-bar--success'
                            : ''
                      }`}
                      style={{ width: `${feishuProgress.percent}%` }}
                    />
                  </div>
                  <div
                    className={`prd-modal__progress-text${
                      feishuProgress.status === 'failed' ? ' prd-modal__progress-text--error' : ''
                    }`}
                  >
                    {feishuProgress.message}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="prd-modal__field">
          <div className="prd-modal__section-head">
            <label className="prd-modal__check">
              <input
                type="checkbox"
                checked={useSourceTree}
                onChange={(event) => {
                  setUseSourceTree(event.target.checked);
                  setSelectionError('');
                  setTargetDirError('');
                  setFolderNameError('');
                  setCommitMessageError('');
                }}
                disabled={busy}
              />
              <span className="prd-modal__check-label">
                <FiGitBranch className="prd-modal__check-icon" />
                <span>同步 SourceTree</span>
              </span>
            </label>
            <div className="prd-modal__section-actions">
              <span className={`prd-modal__pill${wantCommit ? ' prd-modal__pill--success' : ''}`}>
                {sourceTreeStatusLabel}
              </span>
              <button type="button" className="prd-modal__link-btn" onClick={openSourceTreeAdvanced} disabled={busy}>
                <FiSettings />
                <span>高级配置</span>
              </button>
            </div>
          </div>
          {useSourceTree ? (
            <div className="prd-modal__section-card">
              <div className="prd-modal__field">
                <label className="prd-modal__label" htmlFor="prd-combined-sync-target-dir">目标目录（绝对路径）</label>
                <div style={{ display: 'flex', gap: 8, alignItems: 'stretch' }}>
                  <input
                    id="prd-combined-sync-target-dir"
                    className="prd-modal__input"
                    style={{ flex: 1, minWidth: 0 }}
                    value={targetDir}
                    placeholder="/Users/you/code/your-repo"
                    onChange={(event) => {
                      setTargetDir(event.target.value);
                      setTargetDirError('');
                    }}
                    disabled={busy}
                  />
                  {supportsPicker ? (
                    <button
                      type="button"
                      className="prd-modal__btn prd-modal__btn--cancel"
                      style={{ flex: '0 0 auto', whiteSpace: 'nowrap' }}
                      onClick={handlePickDirectory}
                      disabled={busy}
                      title="浏览器只能取到目录名；如需完整路径，可在 Finder 里按 Option + Command + C 复制"
                    >
                      选择目录
                    </button>
                  ) : null}
                </div>
                <div className="prd-modal__hint">
                  需填写已 clone 的 git 仓库目录，或它的父目录。
                  {supportsPicker ? '「选择目录」只能辅助回填目录名；如需完整路径，可在 mac 的 Finder 中选中文件夹后按 Option + Command + C 复制路径，再粘贴到这里。' : ''}
                </div>
                {targetDirError ? <div className="prd-modal__error">{targetDirError}</div> : null}
              </div>

              <div className="prd-modal__field">
                <label className="prd-modal__label" htmlFor="prd-combined-sync-folder-name">子文件夹名称</label>
                <input
                  id="prd-combined-sync-folder-name"
                  className="prd-modal__input"
                  value={folderName}
                  placeholder="例如：prd-docs"
                  onChange={(event) => {
                    setFolderName(event.target.value);
                    setFolderNameError('');
                  }}
                  disabled={busy}
                />
                <div className="prd-modal__hint">同步内容将写入“目标目录 / 子文件夹”，已存在则直接镜像更新。</div>
                {folderNameError ? <div className="prd-modal__error">{folderNameError}</div> : null}
              </div>

              <div className="prd-modal__field">
                <div className="prd-modal__label">执行方式</div>
                <div className="prd-modal__choice-group" role="radiogroup" aria-label="执行方式">
                  {MODE_OPTIONS.map((option) => (
                    <button
                      key={option.value}
                      type="button"
                      className={`prd-modal__choice${mode === option.value ? ' prd-modal__choice--active' : ''}`}
                      role="radio"
                      aria-checked={mode === option.value}
                      onClick={() => setMode(option.value)}
                      disabled={busy}
                    >
                      <span className="prd-modal__choice-title">{option.label}</span>
                      <span className="prd-modal__choice-desc">{option.desc}</span>
                    </button>
                  ))}
                </div>
                <div className="prd-modal__hint">push 失败不会回滚 commit；会直接把 git 报错返回给你。</div>
              </div>

              {wantCommit ? (
                <div className="prd-modal__field">
                  <label className="prd-modal__label" htmlFor="prd-combined-sync-commit-msg">Commit message</label>
                  <textarea
                    id="prd-combined-sync-commit-msg"
                    className="prd-modal__textarea"
                    value={commitMessage}
                    onChange={(event) => {
                      setCommitMessage(event.target.value);
                      setCommitMessageError('');
                    }}
                    placeholder="支持多行；可手动拖拽拉高"
                    disabled={busy}
                  />
                  <div className="prd-modal__hint">默认自动生成提交说明，你也可以按需改成更具体的描述。</div>
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
          ) : null}
        </div>

        {selectionError ? <div className="prd-modal__error">{selectionError}</div> : null}
        </div>

        <div className="prd-modal__actions">
          <button
            type="button"
            className="prd-modal__btn prd-modal__btn--cancel"
            onClick={onCancel}
            disabled={busy}
          >
            取消
          </button>
          <button
            type="button"
            className="prd-modal__btn prd-modal__btn--primary"
            onClick={() => void handleConfirm()}
            disabled={busy || (!useFeishu && !useSourceTree)}
          >
            <FiCheckSquare />
            <span>{buildPrimaryLabel({ useFeishu, useSourceTree, submitting: busy })}</span>
          </button>
        </div>
      </div>
    </div>
  );
}
