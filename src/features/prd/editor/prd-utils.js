import { toSafeDocBaseName } from '../../../../shared/prd-filename-sanitize.js';
import { DEFAULT_PRD_SLUG } from './prd-constants.js';

export function slugToMdPath(slug) {
  return `/pages/${slug}/prd.md`;
}

export function slugToApiSuffix(slug) {
  return `?slug=${encodeURIComponent(slug || DEFAULT_PRD_SLUG)}`;
}

/** 与后端 create-doc / rename-doc 相同的文档主文件名规则（允许中文） */
export function normalizeProjectLikeName(name) {
  return toSafeDocBaseName(name);
}

/** 对 /pages/... 等资源路径分段编码，保证中文文件名在 fetch 中可用 */
export function encodePrdResourcePath(resourcePath) {
  const raw = String(resourcePath || '');
  const [pathPart, ...queryParts] = raw.split('?');
  const query = queryParts.length ? `?${queryParts.join('?')}` : '';
  const encoded = pathPart
    .split('/')
    .map((seg) => (seg ? encodeURIComponent(seg) : ''))
    .join('/');
  return encoded + query;
}

export function mapPrdFileNameError(error) {
  if (error === 'document name is invalid') return '请输入合法文件名';
  if (error === 'name must contain english letters, numbers, dots, underscores or hyphens') return '请输入合法文件名';
  if (error === 'newName must contain english letters, numbers, dots, underscores or hyphens') return '请输入合法文件名';
  return error || '';
}

let _idSeq = 0;
export function genId() {
  return `blk-${Date.now()}-${++_idSeq}`;
}

export function extractPrdImagePaths(text) {
  const set = new Set();
  if (!text || typeof text !== 'string') return set;
  const re = /\/prd\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp)/gi;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[0]);
  return set;
}

export function diffRemovedPrdPaths(oldMd, newMd) {
  const oldSet = extractPrdImagePaths(oldMd);
  const newSet = extractPrdImagePaths(newMd);
  return [...oldSet].filter((p) => !newSet.has(p));
}

export function cloneSerializable(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}

export function getHeadingFontSize(tag) {
  switch (tag) {
    case 'h1': return '24px';
    case 'h2': return '18px';
    case 'h3': return '15px';
    case 'h4': return '13px';
    case 'h5': return '12px';
    case 'h6': return '11px';
    case 'h7': return '10px';
    default: return '15px';
  }
}

export function isTableKindSelection(sel) {
  return sel && (sel.type === 'table-col' || sel.type === 'table-row');
}

export function isNodeHovered(node) {
  return !!node && typeof node.matches === 'function' && node.matches(':hover');
}

export function nodeContainsTarget(node, target) {
  return !!node && typeof Node !== 'undefined' && target instanceof Node && node.contains(target);
}

/** 表格內選取是否應將 block 操作條錨定到選區（text-block / 儲存格圖片） */
export function shouldFloatTableBlockToolbar(blockId, globalSelection) {
  if (!globalSelection || globalSelection.blockId !== blockId) return false;
  if (globalSelection.type === 'text-block') return true;
  if (globalSelection.type === 'image') return Boolean(globalSelection.cellPath);
  return false;
}

const escapeCssAttr = (value) => (
  typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(String(value))
    : String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')
);

/**
 * 依 globalSelection 查找表格內對應的錨點 DOM（預覽態 Markdown / 圖片容器上的 data-*）
 */
export function findTableBlockToolbarAnchor(blockId, globalSelection) {
  if (!globalSelection || globalSelection.blockId !== blockId) return null;
  const bid = escapeCssAttr(blockId);

  if (globalSelection.type === 'text-block') {
    const cp = globalSelection.cellPath;
    if (cp && typeof cp.ri === 'number' && typeof cp.ci === 'number' && typeof cp.idx === 'number') {
      return document.querySelector(
        `[data-prd-toolbar-anchor-block="${bid}"][data-prd-toolbar-anchor-ri="${cp.ri}"][data-prd-toolbar-anchor-ci="${cp.ci}"][data-prd-toolbar-anchor-idx="${cp.idx}"]`,
      );
    }
    const role = globalSelection.role;
    if (role != null && role !== '') {
      return document.querySelector(
        `[data-prd-toolbar-anchor-block="${bid}"][data-prd-toolbar-anchor-role="${escapeCssAttr(role)}"]`,
      );
    }
    return null;
  }

  if (globalSelection.type === 'image') {
    const cp = globalSelection.cellPath;
    if (!cp || typeof cp.ri !== 'number' || typeof cp.ci !== 'number' || typeof cp.idx !== 'number') {
      return null;
    }
    return document.querySelector(
      `[data-prd-toolbar-anchor-block="${bid}"][data-prd-toolbar-anchor-ri="${cp.ri}"][data-prd-toolbar-anchor-ci="${cp.ci}"][data-prd-toolbar-anchor-idx="${cp.idx}"][data-prd-toolbar-anchor-kind="image"]`,
    );
  }

  return null;
}
