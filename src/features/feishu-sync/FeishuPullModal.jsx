import { useCallback, useEffect, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  FiExternalLink,
  FiLogIn,
  FiLogOut,
  FiRefreshCw,
  FiDownload,
  FiX,
} from 'react-icons/fi';
import { getPhaseLabel } from './shared.js';
import './index.css';

export function FeishuPullModal({
  open,
  onClose,
  controller,
}) {
  const {
    status,
    statusError,
    docUrl,
    job,
    pullSubmitting,
    isPulling,
    authTone,
    refreshStatus,
    setDocUrl,
    startAuth,
    logout,
    startPull,
  } = controller;

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  const handleClose = useCallback(() => {
    if (isPulling) return;
    onClose?.();
  }, [isPulling, onClose]);

  const phaseLabel = useMemo(() => {
    if (job?.phase === 'completed') return '拉取完成';
    if (job?.phase === 'failed') return '拉取失败';
    return getPhaseLabel(job?.phase);
  }, [job?.phase]);

  if (!open) return null;

  return (
    createPortal(
      <div className="prd-feishu-sync__overlay" onClick={handleClose}>
        <div className="prd-feishu-sync" onClick={(event) => event.stopPropagation()}>
          <div className="prd-feishu-sync__header">
            <div className="prd-feishu-sync__title-wrap">
              <div className="prd-feishu-sync__title">从飞书拉取文档</div>
              <div className="prd-feishu-sync__desc">
                将目标飞书文档转为本地 PRD Markdown（含表格岛块等），并新建 doc 目录保存。
              </div>
            </div>
            <button
              type="button"
              className="prd-feishu-sync__close"
              onClick={handleClose}
              disabled={isPulling}
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
                      disabled={isPulling}
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
                disabled={isPulling}
              />
              <div className="prd-feishu-sync__hint">
                拉取成功后会新建下一个
                {' '}
                <code>doc-NNN</code>
                {' '}
                目录，正文与
                {' '}
                <code>./assets/</code>
                {' '}
                图片一并写入。正文按「代码围栏外的标题行」切成多节解析；某一节无法解析时会跳过该节并插入说明段落，其余节照常落盘。
              </div>
            </div>

            <div className="prd-feishu-sync__section">
              <div className="prd-feishu-sync__section-head">
                <span>拉取进度</span>
                <span className="prd-feishu-sync__phase">{phaseLabel}</span>
              </div>
              <div className="prd-feishu-sync__progress-track">
                <div
                  className="prd-feishu-sync__progress-bar"
                  style={{ width: `${Math.max(0, Math.min(100, job?.percent || 0))}%` }}
                />
              </div>
              <div className="prd-feishu-sync__progress-meta">
                <span>{job?.message || '尚未开始拉取'}</span>
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
              disabled={isPulling}
            >
              关闭
            </button>
            <button
              type="button"
              className="prd-feishu-sync__primary-btn"
              onClick={() => void startPull()}
              disabled={!status.configured || !status.authenticated || !docUrl.trim() || pullSubmitting || isPulling}
            >
              <FiDownload />
              <span>{pullSubmitting || isPulling ? '拉取中…' : '开始拉取'}</span>
            </button>
          </div>
        </div>
      </div>,
      document.body,
    )
  );
}
