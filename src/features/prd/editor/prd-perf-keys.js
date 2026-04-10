import {
  ENABLE_IMAGE_ANNOTATION_UI,
  ENABLE_TABLE_CELL_ANNOTATION_UI,
  MERMAID_BLOCK_DEFAULT_WIDTH,
  MINDMAP_BLOCK_DEFAULT_WIDTH,
  DEFAULT_DIAGRAM_VIEW_MODE,
} from './prd-constants.js';
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

/** 独立 Mermaid 块 meta：按 block.id，避免仅改代码导致视图模式退回「仅代码」 */
export function mermaidStandaloneMetaKey(blockId) {
  return `mermaid_s_${blockId}`;
}

/** 表格单元格内 Mermaid：块 id + 单元格坐标 + 元素序号 */
export function mermaidTableMetaKey(blockId, ri, ci, elementIdx) {
  return `mermaid_t_${blockId}_${ri}_${ci}_${elementIdx}`;
}

export function resolveMermaidViewMode(mermaidMeta, code, placement) {
  const legacy = mermaidCodeToMetaKey(code || '');
  let primary = legacy;
  if (placement?.kind === 'standalone' && placement.blockId) {
    primary = mermaidStandaloneMetaKey(placement.blockId);
  } else if (placement?.kind === 'table' && placement.blockId != null) {
    primary = mermaidTableMetaKey(placement.blockId, placement.ri, placement.ci, placement.idx);
  }
  return mermaidMeta?.mermaidViewModes?.[primary]
    ?? mermaidMeta?.mermaidViewModes?.[legacy]
    ?? DEFAULT_DIAGRAM_VIEW_MODE;
}

export function resolveMermaidWidth(mermaidMeta, code, placement, defaultWidth) {
  const legacy = mermaidCodeToMetaKey(code || '');
  let primary = legacy;
  if (placement?.kind === 'standalone' && placement.blockId) {
    primary = mermaidStandaloneMetaKey(placement.blockId);
  } else if (placement?.kind === 'table' && placement.blockId != null) {
    primary = mermaidTableMetaKey(placement.blockId, placement.ri, placement.ci, placement.idx);
  }
  const w = mermaidMeta?.mermaidWidths?.[primary] ?? mermaidMeta?.mermaidWidths?.[legacy];
  return w ?? defaultWidth;
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

export function mindmapStandaloneMetaKey(blockId) {
  return `mindmap_s_${blockId}`;
}

export function mindmapTableMetaKey(blockId, ri, ci, elementIdx) {
  return `mindmap_t_${blockId}_${ri}_${ci}_${elementIdx}`;
}

export function resolveMindmapViewMode(mindmapMeta, code, placement) {
  const legacy = mindmapCodeToMetaKey(code || '');
  let primary = legacy;
  if (placement?.kind === 'standalone' && placement.blockId) {
    primary = mindmapStandaloneMetaKey(placement.blockId);
  } else if (placement?.kind === 'table' && placement.blockId != null) {
    primary = mindmapTableMetaKey(placement.blockId, placement.ri, placement.ci, placement.idx);
  }
  return mindmapMeta?.mindmapViewModes?.[primary]
    ?? mindmapMeta?.mindmapViewModes?.[legacy]
    ?? DEFAULT_DIAGRAM_VIEW_MODE;
}

export function resolveMindmapWidth(mindmapMeta, code, placement, defaultWidth) {
  const legacy = mindmapCodeToMetaKey(code || '');
  let primary = legacy;
  if (placement?.kind === 'standalone' && placement.blockId) {
    primary = mindmapStandaloneMetaKey(placement.blockId);
  } else if (placement?.kind === 'table' && placement.blockId != null) {
    primary = mindmapTableMetaKey(placement.blockId, placement.ri, placement.ci, placement.idx);
  }
  const w = mindmapMeta?.mindmapWidths?.[primary] ?? mindmapMeta?.mindmapWidths?.[legacy];
  return w ?? defaultWidth;
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
  const blockId = block.id;
  const rows = block.content?.rows || [];
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    for (let ci = 0; ci < row.length; ci += 1) {
      const elements = getCellElements(row[ci]);
      elements.forEach((element, idx) => {
        if (element?.type === 'mermaid') mermaidKeys.push(mermaidTableMetaKey(blockId, ri, ci, idx));
        if (element?.type === 'mindmap') mindmapKeys.push(mindmapTableMetaKey(blockId, ri, ci, idx));
      });
    }
  }
  return { mermaidKeys, mindmapKeys };
}

export function getBlockMermaidMetaPerfKey(block, mermaidMeta) {
  if (block?.type === 'mermaid') {
    const code = block.content?.code || '';
    const placement = { kind: 'standalone', blockId: block.id };
    const mode = resolveMermaidViewMode(mermaidMeta, code, placement);
    const w = resolveMermaidWidth(mermaidMeta, code, placement, MERMAID_BLOCK_DEFAULT_WIDTH);
    const primary = mermaidStandaloneMetaKey(block.id);
    return `${primary}:${mode}:${w}`;
  }
  if (block?.type !== 'table') return '';
  const rows = block.content?.rows || [];
  const parts = [];
  const blockId = block.id;
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    for (let ci = 0; ci < row.length; ci += 1) {
      const elements = getCellElements(row[ci]);
      elements.forEach((element, idx) => {
        if (element?.type !== 'mermaid') return;
        const placement = { kind: 'table', blockId, ri, ci, idx };
        const mode = resolveMermaidViewMode(mermaidMeta, element.code, placement);
        parts.push(`${mermaidTableMetaKey(blockId, ri, ci, idx)}:${mode}`);
      });
    }
  }
  return parts.join('|');
}

export function getBlockMindmapMetaPerfKey(block, mindmapMeta) {
  if (block?.type === 'mindmap') {
    const code = block.content?.code || '';
    const placement = { kind: 'standalone', blockId: block.id };
    const mode = resolveMindmapViewMode(mindmapMeta, code, placement);
    const w = resolveMindmapWidth(mindmapMeta, code, placement, MINDMAP_BLOCK_DEFAULT_WIDTH);
    const primary = mindmapStandaloneMetaKey(block.id);
    return `${primary}:${mode}:${w}`;
  }
  if (block?.type !== 'table') return '';
  const rows = block.content?.rows || [];
  const parts = [];
  const blockId = block.id;
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    for (let ci = 0; ci < row.length; ci += 1) {
      const elements = getCellElements(row[ci]);
      elements.forEach((element, idx) => {
        if (element?.type !== 'mindmap') return;
        const placement = { kind: 'table', blockId, ri, ci, idx };
        const mode = resolveMindmapViewMode(mindmapMeta, element.code, placement);
        parts.push(`${mindmapTableMetaKey(blockId, ri, ci, idx)}:${mode}`);
      });
    }
  }
  return parts.join('|');
}

export function getTableAnnotationsPerfKey(rowBindings, annotationsDoc) {
  if (!rowBindings?.length) return '';
  /** 關閉圖片標註 UI 時不掃描各圖 region 數量。關閉表格單元格標註 UI 時 stateKey 為空字串（不序列化 changeIntent / 待確認）。 */
  const usageRegionCount = ENABLE_IMAGE_ANNOTATION_UI
    ? new Map(
      (annotationsDoc?.usages || []).map((usage) => [
        usage.usageId,
        getUsageRegions(annotationsDoc, usage.usageId).length,
      ]),
    )
    : null;
  return rowBindings.map((binding) => {
    let stateKey = '';
    if (ENABLE_TABLE_CELL_ANNOTATION_UI) {
      const state = annotationsDoc?.cellStates?.[binding.rowKey] || {};
      stateKey = Object.entries(state)
        .map(([column, value]) => `${column}:${value?.changeIntent || ''}:${value?.pendingConfirm ? 1 : 0}:${value?.pendingConfirmNote || ''}`)
        .join(',');
    }
    const usageKey = (binding.usages || [])
      .map((usage) => (usageRegionCount
        ? `${usage.usageId}:${usageRegionCount.get(usage.usageId) || 0}`
        : usage.usageId))
      .join(',');
    return `${binding.rowKey}[${stateKey}](${usageKey})`;
  }).join('|');
}
