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

/**
 * 从 MD/任意文本中提取 PRD 图片路径，覆盖三种格式：
 *   1) ./assets/<file>                 doc 自带（colocated，写在 MD 源里）
 *   2) /pages/<slug>/assets/<file>     doc 自带（浏览器加载用的 URL 形式）
 *   3) /prd/<file>                     旧的全局公共目录（兼容期保留）
 *
 * 返回 Set<string>，值是文本中**字面**出现的形式，便于做去重 / diff，
 * 也便于把同一个 path 直接传给后端（后端会判别三种格式）。
 */
export function extractPrdImagePaths(text) {
  const set = new Set();
  if (!text || typeof text !== 'string') return set;
  const re = /(?:\/prd\/[a-zA-Z0-9_.-]+|\/pages\/doc-\d+\/assets\/[a-zA-Z0-9_.-]+|(?:^|[^\w./])\.\/assets\/[a-zA-Z0-9_.-]+)\.(?:png|jpe?g|gif|webp|svg|bmp)/gi;
  let m;
  while ((m = re.exec(text)) !== null) {
    // 上面 ./assets 的 lookbehind 用了非捕获前缀，这里规整成纯路径字符串
    const raw = m[0];
    const idx = raw.indexOf('./assets/');
    set.add(idx > 0 ? raw.slice(idx) : raw);
  }
  return set;
}

export function diffRemovedPrdPaths(oldMd, newMd) {
  const oldSet = extractPrdImagePaths(oldMd);
  const newSet = extractPrdImagePaths(newMd);
  return [...oldSet].filter((p) => !newSet.has(p));
}

/** 判断一段路径是否属于 PRD 图片（任一兼容格式） */
export function isPrdImagePath(s) {
  if (typeof s !== 'string') return false;
  return /^(?:\/prd\/|\/pages\/doc-\d+\/assets\/|\.\/assets\/)[a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp|svg|bmp)$/i.test(s);
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

/**
 * 當前選區是否落在指定表格 block 內（列/欄、表頭文字、儲存格內文字或圖片）
 */
export function isGlobalSelectionInTableBlock(blockId, sel) {
  if (!sel || sel.blockId !== blockId) return false;
  if (sel.type === 'table-col' || sel.type === 'table-row') return true;
  if (sel.type === 'text-block') return true;
  if (sel.type === 'image' && sel.cellPath != null) return true;
  if (sel.type === 'diagram' && sel.cellPath != null) return true;
  return false;
}

/** 儲存格內某一元素（文字/圖片）是否為當前 globalSelection 所指 */
export function isGlobalSelectionOnTableCellElement(sel, blockId, ri, ci, idx) {
  if (!sel || sel.blockId !== blockId) return false;
  if (sel.type === 'image') {
    return sel.cellPath?.ri === ri && sel.cellPath?.ci === ci && sel.cellPath?.idx === idx;
  }
  if (sel.type === 'diagram') {
    return sel.cellPath?.ri === ri && sel.cellPath?.ci === ci && sel.cellPath?.idx === idx;
  }
  if (sel.type === 'text-block' && sel.cellPath != null) {
    return sel.cellPath.ri === ri && sel.cellPath.ci === ci && sel.cellPath.idx === idx;
  }
  return false;
}

/**
 * globalSelection 是否相對於「本儲存格 (ri,ci)」為外部（其他 block、表頭、列欄選取、其他儲存格）
 */
export function isForeignSelectionForTableCell(sel, blockId, ri, ci) {
  if (!sel) return false;
  if (sel.blockId !== blockId) return true;
  if (sel.type === 'table-col' || sel.type === 'table-row') return true;
  if (sel.type === 'text-block') {
    if (sel.cellPath == null) return true;
    return sel.cellPath.ri !== ri || sel.cellPath.ci !== ci;
  }
  if (sel.type === 'image') {
    if (sel.cellPath == null) return true;
    return sel.cellPath.ri !== ri || sel.cellPath.ci !== ci;
  }
  if (sel.type === 'diagram') {
    if (sel.cellPath == null) return true;
    return sel.cellPath.ri !== ri || sel.cellPath.ci !== ci;
  }
  return true;
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

/**
 * 去掉标题里常见的 Markdown 行内标记，供目录树 / 导出 TOC 纯文本展示（不解析为 HTML）。
 * 处理：行内代码、图片与链接、删除线、双星号/双下划线加粗、单星号或下划线斜体（下划线规则避免误伤 snake_case）。
 */
export function stripInlineMarkdownForTocDisplay(raw) {
  if (typeof raw !== 'string') return '';
  let t = raw.trim();
  if (!t) return '';

  t = t.replace(/`([^`]+)`/g, '$1');
  t = t.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  t = t.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  t = t.replace(/<https?:\/\/[^>\s]+>/gi, (m) => m.slice(1, -1));
  t = t.replace(/<[^>\s]+@[^>\s]+>/g, (m) => m.slice(1, -1));
  t = t.replace(/~~(.+?)~~/g, '$1');

  for (let i = 0; i < 32; i += 1) {
    const next = t.replace(/\*\*(.+?)\*\*/gs, '$1');
    if (next === t) break;
    t = next;
  }
  for (let i = 0; i < 32; i += 1) {
    const next = t.replace(/__(.+?)__/gs, '$1');
    if (next === t) break;
    t = next;
  }

  t = t.replace(/(?<!\*)\*(?!\*)([^*\n]+?)(?<!\*)\*(?!\*)/g, '$1');
  t = t.replace(/(?<![A-Za-z0-9])_([^_\n]+?)_(?![A-Za-z0-9])/g, '$1');

  return t.trim();
}
