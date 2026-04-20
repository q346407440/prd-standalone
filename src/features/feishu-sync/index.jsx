import { useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
  FiExternalLink,
  FiLogIn,
  FiLogOut,
  FiRefreshCw,
  FiSend,
  FiX,
} from 'react-icons/fi';
import './index.css';

export function FeishuSyncModal({
  open,
  onClose,
  controller,
}) {
  const {
    status,
    statusError,
    docUrl,
    job,
    syncSubmitting,
    isSyncing,
    authTone,
    summaryTitle,
    phaseLabel,
    refreshStatus,
    setDocUrl,
    startAuth,
    logout,
    startSync,
  } = controller;

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  const handleClose = useCallback(() => {
    if (isSyncing) return;
    onClose?.();
  }, [isSyncing, onClose]);

  if (!open) return null;

  return (
    createPortal(
      <div className="prd-feishu-sync__overlay" onClick={handleClose}>
        <div className="prd-feishu-sync" onClick={(event) => event.stopPropagation()}>
          <div className="prd-feishu-sync__header">
            <div className="prd-feishu-sync__title-wrap">
              <div className="prd-feishu-sync__title">同步到飞书文档</div>
              <div className="prd-feishu-sync__desc">本地 PRD 将按阶段同步到目标飞书文档。</div>
            </div>
            <button
              type="button"
              className="prd-feishu-sync__close"
              onClick={handleClose}
              disabled={isSyncing}
              aria-label="关闭"
            >
              <FiX />
            </button>
          </div>

          <div className="prd-feishu-sync__body">
            <div className={`prd-feishu-sync__status-card prd-feishu-sync__status-card--${authTone}`}>
              <div className="prd-feishu-sync__status-line">
                <div className="prd-feishu-sync__status-main">
                  <span className="prd-feishu-sync__status-label">授权状态</span>
                  <span className="prd-feishu-sync__status-value">
                    {!status.configured
                      ? '未配置环境变量'
                      : status.authenticated
                        ? `已连接 ${status.user?.name || '飞书账号'}`
                        : '未连接飞书账号'}
                  </span>
                </div>
                <div className="prd-feishu-sync__status-actions">
                  <button
                    type="button"
                    className="prd-feishu-sync__ghost-btn"
                    onClick={() => void refreshStatus()}
                    disabled={status.loading}
                  >
                    <FiRefreshCw />
                    <span>{status.loading ? '刷新中…' : '刷新状态'}</span>
                  </button>
                  {status.authenticated ? (
                    <button
                      type="button"
                      className="prd-feishu-sync__ghost-btn"
                      onClick={() => void logout()}
                      disabled={isSyncing}
                    >
                      <FiLogOut />
                      <span>清除授权</span>
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="prd-feishu-sync__primary-btn"
                      onClick={startAuth}
                      disabled={!status.configured}
                    >
                      <FiLogIn />
                      <span>连接飞书</span>
                    </button>
                  )}
                </div>
              </div>

              {status.user?.avatarUrl ? (
                <div className="prd-feishu-sync__user-row">
                  <img className="prd-feishu-sync__avatar" src={status.user.avatarUrl} alt="" />
                  <div className="prd-feishu-sync__user-meta">
                    <span>{status.user.name || '飞书用户'}</span>
                    {status.user.email ? <span>{status.user.email}</span> : null}
                  </div>
                </div>
              ) : null}

              {!status.configured ? (
                <div className="prd-feishu-sync__hint">
                  需要先在本地环境中提供
                  {' '}
                  <code>{status.requiredEnv.join(', ')}</code>
                  {' '}
                  ，然后重启开发服务。
                </div>
              ) : null}
              {status.redirectUri ? (
                <div className="prd-feishu-sync__hint">
                  当前回调地址：
                  {' '}
                  <code>{status.redirectUri}</code>
                </div>
              ) : null}
              {statusError ? <div className="prd-feishu-sync__error">{statusError}</div> : null}
            </div>

            <div className="prd-feishu-sync__section">
              <div className="prd-feishu-sync__section-head">
                <span>目标文档</span>
                <a className="prd-feishu-sync__link" href="https://open.feishu.cn/" target="_blank" rel="noreferrer">
                  <FiExternalLink />
                  <span>开放平台</span>
                </a>
              </div>
              <input
                className="prd-feishu-sync__input"
                value={docUrl}
                onChange={(event) => setDocUrl(event.target.value)}
                placeholder="粘贴飞书 docx / wiki 链接"
                disabled={isSyncing}
              />
              <div className="prd-feishu-sync__hint">
                当前来源：
                {' '}
                <code>{summaryTitle}</code>
                。首次同步会全量写入；只有继续同步同一份 PRD 到同一目标文档时，才会走增量更新。
                建议在飞书文档右上角「…」→「页宽设置」中选择「较宽」以获得最佳展示效果。
              </div>
            </div>

            <div className="prd-feishu-sync__section">
              <div className="prd-feishu-sync__section-head">
                <span>同步进度</span>
                <span className="prd-feishu-sync__phase">{phaseLabel}</span>
              </div>
              <div className="prd-feishu-sync__progress-track">
                <div
                  className="prd-feishu-sync__progress-bar"
                  style={{ width: `${Math.max(0, Math.min(100, job?.percent || 0))}%` }}
                />
              </div>
              <div className="prd-feishu-sync__progress-meta">
                <span>{job?.message || '尚未开始同步'}</span>
                <span>{Math.max(0, Math.min(100, job?.percent || 0))}%</span>
              </div>
              {job?.error ? <div className="prd-feishu-sync__error">{job.error}</div> : null}
            </div>
          </div>

          <div className="prd-feishu-sync__footer">
            <button
              type="button"
              className="prd-feishu-sync__ghost-btn"
              onClick={handleClose}
              disabled={isSyncing}
            >
              关闭
            </button>
            <button
              type="button"
              className="prd-feishu-sync__primary-btn"
              onClick={() => void startSync()}
              disabled={!status.configured || !status.authenticated || !docUrl.trim() || syncSubmitting || isSyncing}
            >
              <FiSend />
              <span>{syncSubmitting || isSyncing ? '同步中…' : '开始同步'}</span>
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  );
}
