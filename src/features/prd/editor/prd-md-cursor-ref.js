/**
 * PRD 編輯器「複製引用」：依 Block[] 取片段、或依序列化結果算 MD 行號（供測試與舊邏輯保留）。
 */

import { serializeMarkdownImage } from './prd-image-markdown.js';
import {
  serializePrd,
  getBlockContentLineRanges1Based,
  serializeCellContent,
  getCellElementCharStartsInSerializedCell,
} from './prd-writer.js';

const SNIPPET_MAX_CHARS = 6000;

function capSnippet(text) {
  const t = String(text ?? '').trimEnd();
  if (t.length <= SNIPPET_MAX_CHARS) return t.trim();
  return `${t.slice(0, SNIPPET_MAX_CHARS).trimEnd()}\n…（已截断）`;
}

/**
 * 從當前塊 / 儲存格元素取出適合貼給 Cursor 的正文片段（與磁碟行號解耦）。
 * @param {object[]} blocks
 * @param {string} blockId
 * @param {{ ri: number, ci: number, idx: number } | null} cellPath
 * @param {{ contentBodyLineOffset?: number } | null} opts
 */
export function extractPrdSnippetForCopy(blocks, blockId, cellPath = null, opts = null) {
  if (!blocks?.length) return '';
  const block = blocks.find((b) => b.id === blockId);
  if (!block) return '';

  const rawOff = opts?.contentBodyLineOffset;
  const offset = Number.isFinite(rawOff) ? Math.max(0, Math.floor(Number(rawOff))) : 0;

  if (cellPath != null && cellPath.ri != null && cellPath.ci != null && cellPath.idx != null) {
    if (block.type !== 'table') return '';
    const { ri, ci, idx } = cellPath;
    const row = block.content?.rows?.[ri];
    const cell = row?.[ci];
    if (!cell) return '';
    const inner = serializeCellContent(cell);
    const starts = getCellElementCharStartsInSerializedCell(cell);
    const startChar = starts[idx] ?? 0;
    const nextStart = idx + 1 < starts.length ? starts[idx + 1] : inner.length;
    return capSnippet(inner.slice(startChar, nextStart));
  }

  const { type, content } = block;
  const headingMatch = type.match(/^h([1-7])$/);
  if (headingMatch) {
    const level = Number(headingMatch[1]);
    const t = content?.markdown ?? content?.text ?? '';
    return capSnippet(`${'#'.repeat(level)} ${t}`.trim());
  }

  if (type === 'paragraph') {
    if (content?.type === 'image') {
      return capSnippet(serializeMarkdownImage(content.src, content.alt));
    }
    const md = content?.markdown ?? '';
    const lines = md.split('\n');
    if (lines.length <= 1) return capSnippet(md.trim());
    const line = lines[offset] != null ? lines[offset] : lines[lines.length - 1];
    return capSnippet((line || '').trim());
  }

  if (type === 'divider') {
    return capSnippet('<!-- block:divider -->\n---');
  }

  if (type === 'mermaid') {
    return capSnippet((content?.code || '').trim());
  }

  if (type === 'mindmap') {
    return capSnippet((content?.code || '').trim());
  }

  if (type === 'table') {
    return '';
  }

  if (type === 'prd-section') {
    const title = content?.title || '';
    return capSnippet(title ? `## ${title}` : '');
  }

  return '';
}

/**
 * @param {string} mdPath 如 /pages/doc-001/xxx.md
 * @param {string} repoFolder
 */
export function formatPrdCursorMdPathOnly(mdPath, repoFolder) {
  const rel = String(mdPath || '').replace(/^\//, '');
  return `@${repoFolder}/${rel}`;
}

/**
 * 第一行為 @repo/path，空行後為片段（無片段時僅路徑行）。
 */
export function formatPrdCopyPathAndSnippet(mdPath, repoFolder, snippet) {
  const pathLine = formatPrdCursorMdPathOnly(mdPath, repoFolder);
  const body = String(snippet ?? '').trim();
  if (!body) return pathLine;
  return `${pathLine}\n\n${body}`;
}

/**
 * @param {object[]} blocks
 * @param {string} blockId
 * @param {{ ri: number, ci: number, idx: number } | null} cellPath 表格儲存格內元素；非表格傳 null
 * @param {string | null | undefined} mdSource **已棄用**：v3 起行區間以 `serializePrd(blocks)` 為準（與磁碟一致時傳入亦應與序列化結果相同）。
 * @param {{ contentBodyLineOffset?: number } | null | undefined} opts 非表格時可傳 `contentBodyLineOffset`：該 block 序列化正文內從 0 起的行下標（多行 paragraph 當前行）。
 * @returns {number | null}
 */
export function computePrdMdCursorLineOneBased(blocks, blockId, cellPath = null, mdSource = null, opts = null) {
  if (!blocks?.length) return null;
  const blockIndex = blocks.findIndex((b) => b.id === blockId);
  if (blockIndex < 0) return null;

  void mdSource;
  const md = serializePrd(blocks);
  const lines = md.split('\n');
  const blockRanges = getBlockContentLineRanges1Based(blocks);
  if (blockIndex >= blockRanges.length) return null;
  const range = blockRanges[blockIndex];

  if (!cellPath) {
    const raw = opts?.contentBodyLineOffset;
    const off = Number.isFinite(raw) ? Math.max(0, Math.floor(Number(raw))) : 0;
    const start = range.contentStartLine;
    const end = range.contentEndLine;
    return Math.min(start + off, end);
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

function findCellMarkerLine(lines, range, rowOneBased, colName) {
  const expected = `<!-- cell:r${rowOneBased}:${colName} -->`;
  const start = range.contentStartLine - 1;
  const end = range.contentEndLine - 1;
  for (let i = start; i <= end; i += 1) {
    if (lines[i].trim() === expected) return i + 1;
  }
  return null;
}
