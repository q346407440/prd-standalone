import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { emitPrdToast } from '../prd/editor/prd-toast.js';
import {
  AUTH_LOGOUT_API,
  AUTH_START_API,
  AUTH_STATUS_API,
  getAuthTone,
  getPullDocUrlStorageKey,
  requestJson,
  PULL_JOB_API_PREFIX,
  PULL_START_API,
} from './shared.js';

export function useFeishuPullController({ onSucceeded } = {}) {
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
  const [docUrl, setDocUrlState] = useState('');
  const [job, setJob] = useState(null);
  const [pullSubmitting, setPullSubmitting] = useState(false);
  const isPulling = Boolean(job && ['queued', 'running'].includes(job.status));
  const pollingTokenRef = useRef(0);

  useEffect(() => () => {
    pollingTokenRef.current += 1;
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const saved = window.localStorage.getItem(getPullDocUrlStorageKey()) || '';
    setDocUrlState(saved);
  }, []);

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

  const setDocUrl = useCallback((value) => {
    setDocUrlState(value);
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(getPullDocUrlStorageKey(), value);
    }
  }, []);

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
        const payload = await requestJson(`${PULL_JOB_API_PREFIX}${encodeURIComponent(jobId)}`);
        if (pollingTokenRef.current !== token) {
          return { ok: false, cancelled: true };
        }
        setJob(payload.job || null);
        if (payload.job?.status === 'succeeded') {
          const result = payload.job?.result;
          if (!silent) {
            const skipN = Number(result?.skippedSections) || 0;
            const suffix = skipN > 0 ? `（${skipN} 节无法按规则解析，已跳过并写入占位说明）` : '';
            emitPrdToast(`已拉取：${result?.title || result?.slug || '新文档'}${suffix}`, {
              duration: skipN > 0 ? 3600 : 2000,
            });
          }
          try {
            onSucceeded?.(result);
          } catch { /* ignore */ }
          void refreshStatus(true);
          return { ok: true, job: payload.job, result };
        }
        if (payload.job?.status === 'failed') {
          const message = payload.job?.error || '拉取失败';
          if (!silent) {
            emitPrdToast(message, { tone: 'error', duration: 3200 });
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
          emitPrdToast(error?.message || '查询拉取进度失败', { tone: 'error', duration: 2800 });
        }
        return { ok: false, error };
      }
    }
    return { ok: false, cancelled: true };
  }, [onSucceeded, refreshStatus]);

  const startPull = useCallback(async () => {
    if (!status.authenticated) {
      emitPrdToast('请先连接飞书账号', { tone: 'warning' });
      return { ok: false, reason: 'auth' };
    }
    if (!docUrl.trim()) {
      emitPrdToast('请先填写飞书文档链接', { tone: 'warning' });
      return { ok: false, reason: 'doc-url' };
    }
    setPullSubmitting(true);
    try {
      const payload = await requestJson(PULL_START_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ docUrl: docUrl.trim() }),
      });
      const nextJob = {
        id: payload.jobId,
        status: 'queued',
        phase: 'queued',
        percent: 0,
        message: '已提交拉取任务',
        error: '',
      };
      setJob(nextJob);
      emitPrdToast('已开始从飞书拉取', { duration: 1400 });
      void pollJobUntilDone(payload.jobId, { silent: false });
      return { ok: true, job: nextJob, jobId: payload.jobId, pending: true };
    } catch (error) {
      emitPrdToast(error?.message || '启动拉取失败', { tone: 'error', duration: 2800 });
      return { ok: false, error };
    } finally {
      setPullSubmitting(false);
    }
  }, [docUrl, pollJobUntilDone, status.authenticated]);

  return {
    status,
    statusError,
    docUrl,
    job,
    pullSubmitting,
    isPulling,
    authTone,
    refreshStatus,
    setDocUrl,
    startAuth: handleStartAuth,
    logout: handleLogout,
    startPull,
  };
}
