export const STORAGE_KEY_TARGET_DIR = 'prd-editor:sourcetree-sync:target-dir';
export const STORAGE_KEY_FOLDER_NAME = 'prd-editor:sourcetree-sync:folder-name';
export const STORAGE_KEY_MODE = 'prd-editor:sourcetree-sync:mode';
export const DEFAULT_SOURCE_TREE_SYNC_MODE = 'commit-and-push';

export const MODE_OPTIONS = [
  {
    value: 'commit-and-push',
    label: '同步 + 自动 commit + push',
    desc: '推荐，直接推到远端',
  },
  {
    value: 'commit',
    label: '同步 + 自动 commit',
    desc: '只提交，不自动 push',
  },
  {
    value: 'files-only',
    label: '仅同步文件',
    desc: '手动去 SourceTree 提交',
  },
];

export function readLocal(key, fallback = '') {
  try { return window.localStorage.getItem(key) || fallback; }
  catch { return fallback; }
}

export function isValidMode(value) {
  return MODE_OPTIONS.some((option) => option.value === value);
}

export function buildDefaultCommitMessage(defaultFolderName) {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const ts = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
  const name = (defaultFolderName || 'PRD').trim();
  return `同步 PRD：${name} ${ts}`;
}
