import {
  SAVE_API,
  DELETE_IMAGE_API,
  META_API,
  SAVE_META_API,
  ANNOTATIONS_API,
  SAVE_ANNOTATIONS_API,
  SAVE_ANNOTATION_ASSET_API,
  DELETE_ANNOTATION_ASSET_API,
  ACTIVE_DOC_API,
  LIST_DOCS_API,
  CREATE_DOC_API,
  SWITCH_DOC_API,
  BACKUP_DOC_API,
  DEFAULT_PRD_SLUG,
} from './prd-constants.js';
import { slugToApiSuffix, encodePrdResourcePath } from './prd-utils.js';
import { createEmptyAnnotationsDoc, normalizeAnnotationsDoc } from './prd-annotations.js';
import { emitPrdToast } from './prd-toast.js';

export async function fetchPrdMd(mdPath) {
  const pathEncoded = encodePrdResourcePath(mdPath);
  const sep = pathEncoded.includes('?') ? '&' : '?';
  const res = await fetch(`${pathEncoded}${sep}t=${Date.now()}`);
  if (!res.ok) throw new Error(`fetch md failed: ${res.status}`);
  return res.text();
}

/** 将 pages/<slug>/ 镜像到 pages-backup/<slug>/s0|s1|s2（三槽轮替覆写最旧槽） */
export async function backupPrdDoc(slug) {
  const res = await fetch(`${BACKUP_DOC_API}${slugToApiSuffix(slug)}`, { method: 'POST' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || `backup failed: ${res.status}`);
  }
  return data;
}

/** GET：pages-backup/<slug>/ 根路径及 s0、s1、s2 槽位（不触发拷贝） */
export async function fetchBackupDocDir(slug) {
  const res = await fetch(`${BACKUP_DOC_API}${slugToApiSuffix(slug)}`, { method: 'GET' });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || typeof data.backupDir !== 'string') {
    throw new Error(data.error || `fetch backup path failed: ${res.status}`);
  }
  return data;
}

export async function savePrdMd(mdText, slug) {
  const res = await fetch(`${SAVE_API}${slugToApiSuffix(slug)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: mdText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'save failed');
}

export async function fetchPrdMeta(slug) {
  try {
    const res = await fetch(`${META_API}${slugToApiSuffix(slug)}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

export async function savePrdMeta(meta, slug, { keepalive = false } = {}) {
  try {
    await fetch(`${SAVE_META_API}${slugToApiSuffix(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
      keepalive,
    });
  } catch (e) {
    console.error('meta save failed', e);
  }
}

export async function fetchPrdAnnotations(slug) {
  try {
    const res = await fetch(`${ANNOTATIONS_API}${slugToApiSuffix(slug)}`, { cache: 'no-store' });
    if (!res.ok) return createEmptyAnnotationsDoc();
    return normalizeAnnotationsDoc(await res.json());
  } catch {
    return createEmptyAnnotationsDoc();
  }
}

export async function savePrdAnnotations(doc, slug) {
  try {
    await fetch(`${SAVE_ANNOTATIONS_API}${slugToApiSuffix(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
  } catch (e) {
    console.error('annotations save failed', e);
  }
}

export async function saveAnnotationAsset(fileName, base64) {
  const res = await fetch(SAVE_ANNOTATION_ASSET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, base64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'save annotation asset failed');
  return data.path || data.url;
}

export async function deleteAnnotationAsset(urlPath) {
  const res = await fetch(DELETE_ANNOTATION_ASSET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: urlPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'delete annotation asset failed');
}

export async function deletePrdImage(urlPath, slug) {
  const url = slug ? `${DELETE_IMAGE_API}${slugToApiSuffix(slug)}` : DELETE_IMAGE_API;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: urlPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'delete image failed');
}

/**
 * 把「原生 MD 导出」的文件树镜像写入用户指定的本地 Git 工作区子目录。
 * entries 里每个 item 已是 `{ relPath, contentBase64 }`。
 */
export async function syncNativeMdToDirectory({
  targetDir,
  folderName,
  entries,
  mode = 'files-only',
  commitMessage = '',
}) {
  const res = await fetch('/__prd__/sync-native-md', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ targetDir, folderName, entries, mode, commitMessage }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || `sync failed: ${res.status}`);
  return data;
}

export async function fetchActiveDoc() {
  const res = await fetch(`${ACTIVE_DOC_API}?t=${Date.now()}`);
  if (!res.ok) return { slug: DEFAULT_PRD_SLUG, mdPath: `/pages/${DEFAULT_PRD_SLUG}/prd.md` };
  return res.json().then(d => ({
    slug: d.slug || DEFAULT_PRD_SLUG,
    mdPath: d.mdPath || `/pages/${d.slug || DEFAULT_PRD_SLUG}/prd.md`,
  }));
}

export async function fetchDocList() {
  const res = await fetch(`${LIST_DOCS_API}?t=${Date.now()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.docs || [];
}

export async function createDoc(name) {
  const res = await fetch(CREATE_DOC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

export async function switchDoc(slug) {
  const res = await fetch(SWITCH_DOC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  return res.json();
}

export async function renameDoc(slug, newName) {
  const res = await fetch('/__prd__/rename-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, newName }),
  });
  return res.json();
}

/**
 * 粘贴图片：写到 pages/<slug>/assets/，返回 ./assets/<file>（要插入 MD 的相对路径）。
 * slug 必填——决定写到哪个 doc 自带的资产目录。
 */
export async function uploadPastedImage(file, slug) {
  if (!slug) throw new Error('uploadPastedImage: slug is required');
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const ext = file.type === 'image/png' ? 'png'
        : file.type === 'image/gif' ? 'gif'
          : file.type === 'image/webp' ? 'webp'
            : 'jpg';
      const fileName = `paste-${Date.now()}.${ext}`;
      try {
        const res = await fetch(`/__prd__/save-image${slugToApiSuffix(slug)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, base64 }),
        });
        const data = await res.json();
        if (data.ok) {
          emitPrdToast('图片粘贴成功');
          resolve(data.path);
        }
        else reject(new Error(data.error));
      } catch (err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}

export async function copyImageToClipboard(src, { emitSuccessToast = true } = {}) {
  if (!src) return false;
  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error(`copy image failed: ${res.status}`);
    const blob = await res.blob();
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          [blob.type || 'image/png']: blob,
        }),
      ]);
      if (emitSuccessToast) emitPrdToast('图片复制成功');
      return true;
    }
  } catch (err) {
    console.error('复制图片到剪贴板失败', err);
  }
  try {
    await navigator.clipboard?.writeText(src);
    if (emitSuccessToast) emitPrdToast('图片复制成功');
    return true;
  } catch (err) {
    console.error('复制图片地址失败', err);
    return false;
  }
}

export async function cutImageToClipboard(src, onDelete) {
  const copied = await copyImageToClipboard(src, { emitSuccessToast: false });
  if (!copied) return false;
  onDelete?.();
  emitPrdToast('图片剪切成功');
  return true;
}

export function getImageFromPaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  return imgItem ? imgItem.getAsFile() : null;
}
