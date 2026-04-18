/**
 * 依當前 Block[] 序列化結果，計算 Cursor @path:line 中的 1-based 行號。
 */

import {
  serializePrd,
  serializeCellContent,
  getCellElementCharStartsInSerializedCell,
} from './prd-writer.js';

const BLOCK_MARKER_RE = /^<!--\s*block:([\w-]+)(?:\s+(.*?))?\s*-->$/;

/**
 * @param {object[]} blocks
 * @param {string} blockId
 * @param {{ ri: number, ci: number, idx: number } | null} cellPath 表格儲存格內元素；非表格傳 null
 * @param {string | null | undefined} mdSource 可選：用於計算行號的完整 MD 正文。傳入時應與當前要對齊的檔案一致（例如已載入未改動的磁碟正文），避免僅依 `serializePrd(blocks)` 時與磁碟在空白行等處不一致導致行號偏移。
 * @returns {number | null}
 */
export function computePrdMdCursorLineOneBased(blocks, blockId, cellPath = null, mdSource = null) {
  if (!blocks?.length) return null;
  const blockIndex = blocks.findIndex((b) => b.id === blockId);
  if (blockIndex < 0) return null;

  const md = (mdSource != null && String(mdSource).length > 0)
    ? String(mdSource)
    : serializePrd(blocks);
  const lines = md.split('\n');
  const blockRanges = scanBlockContentLineRanges(lines);
  if (blockIndex >= blockRanges.length) return null;
  const range = blockRanges[blockIndex];

  if (!cellPath) {
    return range.contentStartLine;
  }

  const { ri, ci, idx } = cellPath;
  const block = blocks[blockIndex];
  if (block?.type !== 'table') return range.contentStartLine;

  const headers = block.content?.headers || [];
  const colName = headers[ci];
  if (colName == null) return range.contentStartLine;

  const markerLine = findCellMarkerLine(lines, range, ri + 1, colName);
  if (markerLine == null) return range.contentStartLine;

  const row = block.content?.rows?.[ri];
  const cell = row?.[ci];
  const inner = serializeCellContent(cell);
  const starts = getCellElementCharStartsInSerializedCell(cell);
  const startChar = starts[idx] ?? 0;
  const prefix = inner.slice(0, startChar);
  const nl = prefix.match(/\n/g);
  return markerLine + 1 + (nl ? nl.length : 0);
}

/**
 * @param {string} mdPath 如 /pages/doc-001/xxx.md
 * @param {number} lineOneBased
 * @param {string} repoFolder
 */
export function formatPrdCursorMdRef(mdPath, lineOneBased, repoFolder) {
  const rel = String(mdPath || '').replace(/^\//, '');
  return `@${repoFolder}/${rel}:${lineOneBased}`;
}

function scanBlockContentLineRanges(lines) {
  const ranges = [];
  let contentStart = null;

  for (let i = 0; i < lines.length; i += 1) {
    const lineNo = i + 1;
    const trimmed = lines[i].trim();
    const m = trimmed.match(BLOCK_MARKER_RE);
    if (m) {
      if (contentStart != null) {
        ranges.push({ contentStartLine: contentStart, contentEndLine: lineNo - 1 });
      }
      contentStart = lineNo + 1;
    }
  }
  if (contentStart != null) {
    ranges.push({ contentStartLine: contentStart, contentEndLine: lines.length });
  }
  return ranges;
}

function findCellMarkerLine(lines, range, rowOneBased, colName) {
  const expected = `<!-- cell:r${rowOneBased}:${colName} -->`;
  const start = range.contentStartLine - 1;
  const end = range.contentEndLine - 1;
  for (let i = start; i <= end; i += 1) {
    if (lines[i].trim() === expected) return i + 1;
  }
  return null;
}
