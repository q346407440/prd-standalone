import { MERMAID_BLOCK_DEFAULT_WIDTH, MINDMAP_BLOCK_DEFAULT_WIDTH } from './prd-constants.js';
import { extractPrdImagePaths, isTableKindSelection } from './prd-utils.js';
import { getUsageRegions } from './prd-annotations.js';

export function mermaidCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return `mermaid_${h.toString(36)}`;
}

export function mindmapCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return `mindmap_${h.toString(36)}`;
}

export function getBlockTextContent(block) {
  if (!block || !block.content) return '';
  if (typeof block.content.markdown === 'string') return block.content.markdown;
  if (typeof block.content.text === 'string') return block.content.text;
  return '';
}

export function getCellElements(cell) {
  if (cell && typeof cell === 'object' && Array.isArray(cell.elements)) return cell.elements;
  if (cell && typeof cell === 'object' && 'element' in cell) return [cell.element];
  if (typeof cell === 'string') return [];
  return [];
}

export function getBlockSelectionPerfKey(block, selection) {
  if (!selection) return 'none';
  if (selection.blockId === block.id) {
    const cellPath = selection.cellPath
      ? `${selection.cellPath.ri ?? ''}.${selection.cellPath.ci ?? ''}.${selection.cellPath.idx ?? ''}`
      : '';
    return [
      'own',
      selection.type || '',
      selection.role || '',
      selection.ri ?? '',
      selection.ci ?? '',
      cellPath,
    ].join(':');
  }
  if (block.type === 'table' && isTableKindSelection(selection)) return 'foreign-table';
  return 'other-selection';
}

export function getRowBindingsPerfKey(rowBindings) {
  if (!rowBindings?.length) return '';
  return rowBindings.map((binding) => [
    binding.rowKey,
    (binding.usages || []).map((usage) => usage.usageId).join(','),
  ].join(':')).join('|');
}

export function getBlockImageMetaPerfKey(block, imageMeta) {
  if (block?.type !== 'paragraph') return '';
  const paths = [...extractPrdImagePaths(getBlockTextContent(block))].sort();
  if (!paths.length) return '';
  return paths.map((path) => `${path}:${imageMeta?.[path] ?? ''}`).join('|');
}

function getTableMetaPerfKeys(block) {
  const mermaidKeys = [];
  const mindmapKeys = [];
  if (block?.type !== 'table') return { mermaidKeys, mindmapKeys };
  for (const row of block.content?.rows || []) {
    for (const cell of row || []) {
      for (const element of getCellElements(cell)) {
        if (element?.type === 'mermaid') mermaidKeys.push(mermaidCodeToMetaKey(element.code || ''));
        if (element?.type === 'mindmap') mindmapKeys.push(mindmapCodeToMetaKey(element.code || ''));
      }
    }
  }
  return { mermaidKeys, mindmapKeys };
}

export function getBlockMermaidMetaPerfKey(block, mermaidMeta) {
  if (block?.type === 'mermaid') {
    const key = mermaidCodeToMetaKey(block.content?.code || '');
    return `${key}:${mermaidMeta?.mermaidViewModes?.[key] || 'code'}:${mermaidMeta?.mermaidWidths?.[key] ?? MERMAID_BLOCK_DEFAULT_WIDTH}`;
  }
  if (block?.type !== 'table') return '';
  const { mermaidKeys } = getTableMetaPerfKeys(block);
  return mermaidKeys.map((key) => `${key}:${mermaidMeta?.mermaidViewModes?.[key] || 'code'}`).join('|');
}

export function getBlockMindmapMetaPerfKey(block, mindmapMeta) {
  if (block?.type === 'mindmap') {
    const key = mindmapCodeToMetaKey(block.content?.code || '');
    return `${key}:${mindmapMeta?.mindmapViewModes?.[key] || 'code'}:${mindmapMeta?.mindmapWidths?.[key] ?? MINDMAP_BLOCK_DEFAULT_WIDTH}`;
  }
  if (block?.type !== 'table') return '';
  const { mindmapKeys } = getTableMetaPerfKeys(block);
  return mindmapKeys.map((key) => `${key}:${mindmapMeta?.mindmapViewModes?.[key] || 'code'}`).join('|');
}

export function getTableAnnotationsPerfKey(rowBindings, annotationsDoc) {
  if (!rowBindings?.length) return '';
  const usageRegionCount = new Map(
    (annotationsDoc?.usages || []).map((usage) => [usage.usageId, getUsageRegions(annotationsDoc, usage.usageId).length]),
  );
  return rowBindings.map((binding) => {
    const state = annotationsDoc?.cellStates?.[binding.rowKey] || {};
    const stateKey = Object.entries(state)
      .map(([column, value]) => `${column}:${value?.changeIntent || ''}:${value?.pendingConfirm ? 1 : 0}:${value?.pendingConfirmNote || ''}`)
      .join(',');
    const usageKey = (binding.usages || [])
      .map((usage) => `${usage.usageId}:${usageRegionCount.get(usage.usageId) || 0}`)
      .join(',');
    return `${binding.rowKey}[${stateKey}](${usageKey})`;
  }).join('|');
}
