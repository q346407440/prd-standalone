export const AUTH_STATUS_API = '/__prd__/feishu/auth/status';
export const AUTH_START_API = '/__prd__/feishu/auth/start';
export const AUTH_LOGOUT_API = '/__prd__/feishu/auth/logout';
export const SYNC_START_API = '/__prd__/feishu/sync/start';
export const SYNC_JOB_API_PREFIX = '/__prd__/feishu/sync/jobs/';

export function getDocUrlStorageKey(slug) {
  return `prd:feishu-doc-url:${slug || 'default'}`;
}

export async function requestJson(url, options) {
  const response = await fetch(url, options);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.ok === false) {
    throw new Error(payload?.error || `请求失败：${response.status}`);
  }
  return payload;
}

export function getAuthTone(status) {
  if (!status.configured) return 'warning';
  if (status.authenticated) return 'success';
  return 'idle';
}

export function getPhaseLabel(phase) {
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
