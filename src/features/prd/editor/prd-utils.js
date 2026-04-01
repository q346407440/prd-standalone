import { DEFAULT_PRD_SLUG } from './prd-constants.js';

export function slugToMdPath(slug) {
  return `/pages/${slug}/prd.md`;
}

export function slugToApiSuffix(slug) {
  return `?slug=${encodeURIComponent(slug || DEFAULT_PRD_SLUG)}`;
}

export function normalizeProjectLikeName(name) {
  return String(name || '')
    .trim()
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

export function mapPrdFileNameError(error) {
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
