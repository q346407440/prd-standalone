import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitPrdToast } from '../prd/editor/prd-toast.js';
import {
  AUTH_LOGOUT_API,
  AUTH_START_API,
  AUTH_STATUS_API,
  getAuthTone,
  getDocUrlStorageKey,
  getPhaseLabel,
  requestJson,
  SYNC_JOB_API_PREFIX,
  SYNC_START_API,
} from './shared.js';

export function useFeishuSyncController({ blocks, activeSlug, activeTitle }) {
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
  const [syncSubmitting, setSyncSubmitting] = useState(false);
  const isSyncing = Boolean(job && ['queued', 'running'].includes(job.status));
  const pollingTokenRef = useRef(0);
  const summaryTitle = activeTitle || activeSlug || '当前 PRD';

  useEffect(() => () => {
    pollingTokenRef.current += 1;
  }, []);

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

  const authTone = useMemo(() => getAuthTone(status), [status]);

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
      pollingTokenRef.current += 1;
      await refreshStatus();
    } catch (error) {
      emitPrdToast(error?.message || '取消授权失败', { tone: 'error', duration: 2800 });
    }
  }, [refreshStatus]);

  const pollJobUntilDone = useCallback(async (jobId, { silent = false } = {}) => {
    const token = ++pollingTokenRef.current;
    while (pollingTokenRef.current === token) {
      try {
        const payload = await requestJson(`${SYNC_JOB_API_PREFIX}${encodeURIComponent(jobId)}`);
        if (pollingTokenRef.current !== token) {
          return { ok: false, cancelled: true };
        }
        setJob(payload.job || null);
        if (payload.job?.status === 'succeeded') {
          const result = payload.job?.result;
          if (!silent) {
            if (result?.incremental && result?.changedBlocks === 0) {
              emitPrdToast('无变更，无需同步');
            } else if (result?.incremental) {
              emitPrdToast(`增量同步完成（变更 ${result.changedBlocks} 个块）`);
            } else if (result?.resetReason === 'source-changed') {
              emitPrdToast('检测到同步来源已切换，已执行全量覆盖同步');
            } else if (result?.resetReason === 'snapshot-source-missing') {
              emitPrdToast('检测到旧快照缺少来源标识，已执行全量覆盖同步');
            } else {
              emitPrdToast('已同步到飞书文档');
            }
          }
          void refreshStatus(true);
          return { ok: true, job: payload.job };
        }
        if (payload.job?.status === 'failed') {
          const message = payload.job?.error || '飞书同步失败';
          if (!silent) {
            emitPrdToast(message, { tone: 'error', duration: 2800 });
          }
          return { ok: false, error: new Error(message), job: payload.job };
        }
        await new Promise((resolve) => {
          window.setTimeout(resolve, 1200);
        });
      } catch (error) {
        if (pollingTokenRef.current !== token) {
          return { ok: false, cancelled: true };
        }
        if (!silent) {
          emitPrdToast(error?.message || '查询同步进度失败', { tone: 'error', duration: 2800 });
        }
        return { ok: false, error };
      }
    }
    return { ok: false, cancelled: true };
  }, [refreshStatus]);

  const handleStartSync = useCallback(async ({ waitForCompletion = false, silent = false } = {}) => {
    if (!status.authenticated) {
      const error = new Error('请先连接飞书账号');
      if (!silent) emitPrdToast(error.message, { tone: 'warning' });
      return { ok: false, error, reason: 'auth' };
    }
    if (!docUrl.trim()) {
      const error = new Error('请先填写目标飞书文档链接');
      if (!silent) emitPrdToast(error.message, { tone: 'warning' });
      return { ok: false, error, reason: 'doc-url' };
    }
    if (!Array.isArray(blocks) || !blocks.length) {
      const error = new Error('当前 PRD 还未加载完成');
      if (!silent) emitPrdToast(error.message, { tone: 'warning' });
      return { ok: false, error, reason: 'blocks' };
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
      const nextJob = {
        id: payload.jobId,
        status: 'queued',
        phase: 'queued',
        percent: 0,
        message: '已提交同步任务',
        error: '',
      };
      setJob(nextJob);
      if (!silent) {
        emitPrdToast('已开始同步飞书文档', { duration: 1400 });
      }
      if (waitForCompletion) {
        return await pollJobUntilDone(payload.jobId, { silent });
      }
      void pollJobUntilDone(payload.jobId, { silent });
      return { ok: true, job: nextJob, jobId: payload.jobId, pending: true };
    } catch (error) {
      if (!silent) {
        emitPrdToast(error?.message || '启动同步失败', { tone: 'error', duration: 2800 });
      }
      return { ok: false, error };
    } finally {
      setSyncSubmitting(false);
    }
  }, [activeSlug, blocks, docUrl, pollJobUntilDone, status.authenticated, summaryTitle]);

  return {
    status,
    statusError,
    docUrl,
    job,
    syncSubmitting,
    isSyncing,
    authTone,
    summaryTitle,
    phaseLabel: getPhaseLabel(job?.phase),
    canStartSync: status.configured && status.authenticated && Boolean(docUrl.trim()) && !syncSubmitting && !isSyncing,
    refreshStatus,
    setDocUrl: handleDocUrlChange,
    startAuth: handleStartAuth,
    logout: handleLogout,
    startSync: handleStartSync,
  };
}
