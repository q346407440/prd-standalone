import { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  FiExternalLink,
  FiLogIn,
  FiLogOut,
  FiRefreshCw,
  FiSend,
  FiX,
} from 'react-icons/fi';
import { emitPrdToast } from '../prd/editor/prd-toast.js';
import './index.css';

const AUTH_STATUS_API = '/__prd__/feishu/auth/status';
const AUTH_START_API = '/__prd__/feishu/auth/start';
const AUTH_LOGOUT_API = '/__prd__/feishu/auth/logout';
const SYNC_START_API = '/__prd__/feishu/sync/start';
const SYNC_JOB_API_PREFIX = '/__prd__/feishu/sync/jobs/';

function getDocUrlStorageKey(slug) {
  return `prd:feishu-doc-url:${slug || 'default'}`;
}

async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `请求失败：${response.status}`);
  }
  return payload;
}

function getAuthTone(status) {
  if (!status.configured) return 'warning';
  if (status.authenticated) return 'success';
  return 'idle';
}

function getPhaseLabel(phase) {
  if (phase === 'uploading-assets') return '上传图片';
  if (phase === 'clearing-document') return '清空文档';
  if (phase === 'writing-blocks') return '写入内容';
  if (phase === 'completed') return '同步完成';
  if (phase === 'failed') return '同步失败';
  if (phase === 'validating') return '校验目标';
  if (phase === 'diffing') return '对比差异';
  if (phase === 'verifying-snapshot') return '校验快照';
  if (phase === 'incremental-delete') return '删除旧块';
  if (phase === 'incremental-insert') return '写入新块';
  return '准备中';
}

export function FeishuSyncEntry({ blocks, activeSlug, activeTitle }) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState({
    loading: false,
    configured: false,
    authenticated: false,
    user: null,
    tokenInfo: null,
    requiredEnv: [],
    redirectUri: '',
  });
  const [statusError, setStatusError] = useState('');
  const [docUrl, setDocUrl] = useState('');
  const [job, setJob] = useState(null);
  const [pollingJobId, setPollingJobId] = useState('');
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const isSyncing = Boolean(job && ['queued', 'running'].includes(job.status));

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(getDocUrlStorageKey(activeSlug)) || '';
    setDocUrl(saved);
  }, [activeSlug]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const authResult = params.get('feishuAuth');
    if (!authResult) return;
    const authMessage = params.get('feishuMessage');
    const authUser = params.get('feishuUser');
    if (authResult === 'success') {
      emitPrdToast(`飞书授权成功${authUser ? `：${authUser}` : ''}`);
    } else {
      emitPrdToast(authMessage || '飞书授权失败', { tone: 'error', duration: 2800 });
    }
    params.delete('feishuAuth');
    params.delete('feishuMessage');
    params.delete('feishuUser');
    const nextUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}${window.location.hash || ''}`;
    window.history.replaceState({}, '', nextUrl);
  }, []);

  const refreshStatus = useCallback(async (silent = false) => {
    if (!silent) {
      setStatus((prev) => ({ ...prev, loading: true }));
      setStatusError('');
    }
    try {
      const payload = await requestJson(AUTH_STATUS_API);
      setStatus({
        loading: false,
        configured: Boolean(payload.configured),
        authenticated: Boolean(payload.authenticated),
        user: payload.user || null,
        tokenInfo: payload.tokenInfo || null,
        requiredEnv: payload.requiredEnv || [],
        redirectUri: payload.redirectUri || '',
      });
      setStatusError('');
    } catch (error) {
      setStatus((prev) => ({ ...prev, loading: false }));
      setStatusError(error?.message || '获取飞书状态失败');
    }
  }, []);

  useEffect(() => {
    void refreshStatus(true);
  }, [refreshStatus]);

  useEffect(() => {
    if (!open) return;
    void refreshStatus();
  }, [open, refreshStatus]);

  useEffect(() => {
    if (!pollingJobId) return undefined;
    let cancelled = false;
    let timer = null;

    async function poll() {
      try {
        const payload = await requestJson(`${SYNC_JOB_API_PREFIX}${encodeURIComponent(pollingJobId)}`);
        if (cancelled) return;
        setJob(payload.job || null);
        if (payload.job?.status === 'succeeded') {
          setPollingJobId('');
          const result = payload.job?.result;
          if (result?.incremental && result?.changedBlocks === 0) {
            emitPrdToast('无变更，无需同步');
          } else if (result?.incremental) {
            emitPrdToast(`增量同步完成（变更 ${result.changedBlocks} 个块）`);
          } else {
            emitPrdToast('已同步到飞书文档');
          }
          void refreshStatus(true);
          return;
        }
        if (payload.job?.status === 'failed') {
          setPollingJobId('');
          emitPrdToast(payload.job?.error || '飞书同步失败', { tone: 'error', duration: 2800 });
          return;
        }
        timer = window.setTimeout(poll, 1200);
      } catch (error) {
        if (cancelled) return;
        setPollingJobId('');
        emitPrdToast(error?.message || '查询同步进度失败', { tone: 'error', duration: 2800 });
      }
    }

    void poll();

    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
  }, [pollingJobId, refreshStatus]);

  const authTone = useMemo(() => getAuthTone(status), [status]);
  const summaryTitle = activeTitle || activeSlug || '当前 PRD';

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const handleClose = useCallback(() => {
    if (isSyncing) return;
    setOpen(false);
  }, [isSyncing]);

  const handleDocUrlChange = useCallback((value) => {
    setDocUrl(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getDocUrlStorageKey(activeSlug), value);
    }
  }, [activeSlug]);

  const handleStartAuth = useCallback(() => {
    window.location.assign(AUTH_START_API);
  }, []);

  const handleLogout = useCallback(async () => {
    try {
      await requestJson(AUTH_LOGOUT_API, { method: 'POST' });
      emitPrdToast('已清除本地飞书授权');
      setJob(null);
      setPollingJobId('');
      await refreshStatus();
    } catch (error) {
      emitPrdToast(error?.message || '取消授权失败', { tone: 'error', duration: 2800 });
    }
  }, [refreshStatus]);

  const handleStartSync = useCallback(async () => {
    if (!status.authenticated) {
      emitPrdToast('请先连接飞书账号', { tone: 'warning' });
      return;
    }
    if (!docUrl.trim()) {
      emitPrdToast('请先填写目标飞书文档链接', { tone: 'warning' });
      return;
    }
    if (!Array.isArray(blocks) || !blocks.length) {
      emitPrdToast('当前 PRD 还未加载完成', { tone: 'warning' });
      return;
    }
    setSyncSubmitting(true);
    try {
      const payload = await requestJson(SYNC_START_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          docUrl: docUrl.trim(),
          sourceSlug: activeSlug,
          sourceTitle: summaryTitle,
          blocks,
        }),
      });
      setJob({
        id: payload.jobId,
        status: 'queued',
        phase: 'queued',
        percent: 0,
        message: '已提交同步任务',
        error: '',
      });
      setPollingJobId(payload.jobId);
      emitPrdToast('已开始同步飞书文档', { duration: 1400 });
    } catch (error) {
      emitPrdToast(error?.message || '启动同步失败', { tone: 'error', duration: 2800 });
    } finally {
      setSyncSubmitting(false);
    }
  }, [activeSlug, blocks, docUrl, status.authenticated, summaryTitle]);

  return (
    <>
      <button
        type="button"
        className="prd-toolbar__btn prd-toolbar__btn--feishu"
        title="同步到飞书文档"
        onClick={handleOpen}
      >
        <FiSend className="prd-toolbar__btn-icon" />
        <span>同步飞书</span>
      </button>

      {open
        ? createPortal(
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
                            onClick={() => void handleLogout()}
                            disabled={isSyncing}
                          >
                            <FiLogOut />
                            <span>清除授权</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="prd-feishu-sync__primary-btn"
                            onClick={handleStartAuth}
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
                      onChange={(event) => handleDocUrlChange(event.target.value)}
                      placeholder="粘贴飞书 docx / wiki 链接"
                      disabled={isSyncing}
                    />
                    <div className="prd-feishu-sync__hint">
                      当前来源：
                      {' '}
                      <code>{summaryTitle}</code>
                      。首次同步全量写入；后续仅增量同步变更部分，以本地 PRD 为准。
                      建议在飞书文档右上角「…」→「页宽设置」中选择「较宽」以获得最佳展示效果。
                    </div>
                  </div>

                  <div className="prd-feishu-sync__section">
                    <div className="prd-feishu-sync__section-head">
                      <span>同步进度</span>
                      <span className="prd-feishu-sync__phase">{getPhaseLabel(job?.phase)}</span>
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
                    onClick={() => void handleStartSync()}
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
        : null}
    </>
  );
}
