import { splitMarkdownByInlineImages } from './prd-inline-image-split.js';
import { parseListPrefix } from './prd-list-utils.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const PURE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const CELL_MERMAID_RE = /^:::mermaid:::([\s\S]*?):::end-mermaid:::$/;
const CELL_MINDMAP_RE = /^:::mindmap:::([\s\S]*?):::end-mindmap:::$/;
const BARE_LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)$/;

// ─── 工具函數 ────────────────────────────────────────────────────────────────

function normalizeBareListPrefix(text) {
  if (!text) return text;
  const match = text.match(BARE_LIST_PREFIX_RE);
  if (!match) return text;
  return `${match[1]}${match[2]} `;
}

export function parseSingleElement(s) {
  const mermaidMatch = s.match(CELL_MERMAID_RE);
  if (mermaidMatch) return { type: 'mermaid', code: mermaidMatch[1].trim() };
  const mindmapMatch = s.match(CELL_MINDMAP_RE);
  if (mindmapMatch) return { type: 'mindmap', code: mindmapMatch[1].trim() };
  const normalized = normalizeBareListPrefix(s);
  const imgMatch = normalized.match(PURE_IMAGE_RE);
  if (imgMatch) return { type: 'image', src: imgMatch[2].trim() };
  /** 有序/無序列表行且正文僅一張行內圖：與飛書能力對齊，收斂為獨立 image 元素（不再保留列表前綴）。 */
  const listParsed = parseListPrefix(normalized.trimEnd());
  if (listParsed) {
    const bodyOnly = (listParsed.body || '').trim();
    if (bodyOnly) {
      const bodyImg = bodyOnly.match(PURE_IMAGE_RE);
      if (bodyImg) return { type: 'image', src: bodyImg[2].trim() };
    }
  }
  return { type: 'text', markdown: normalized };
}

/**
 * 把單元格字串解析為 CellElement。
 * 格內多個段落以 <br> 分隔。表格列在原始檔中須以 `|` 開頭；儲格內若需真換行（如 Mermaid 多行），
 * 由 parseGfmTable 合併後續不以 `|` 開頭的續行。
 * 回傳 { elements: Element[] }
 */
export function parseCellElement(cellStr) {
  const s = (cellStr || '').trimEnd();
  const parts = s
    .split(/<br\s*\/?>/i)
    .map((p) => p.trimEnd())
    .filter((p) => p.trim() !== '');
  if (parts.length === 0) {
    return { elements: [{ type: 'text', markdown: '' }] };
  }
  return {
    elements: parts
      .map(parseSingleElement)
      .flatMap((el) => {
        if (el.type !== 'text') return [el];
        return splitMarkdownByInlineImages(el.markdown ?? '');
      }),
  };
}

export function parseGfmTable(block) {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const merged = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.startsWith('|')) {
      i += 1;
      continue;
    }
    let row = line;
    i += 1;
    while (i < lines.length && !lines[i].startsWith('|')) {
      row += `\n${lines[i]}`;
      i += 1;
    }
    merged.push(row);
  }
  const tableLines = merged;
  if (tableLines.length < 2) return { type: 'table', headers: [], rows: [] };

  const parseRow = (line) =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      .map((c) => c.replace(/^ /, '').trimEnd());

  const headers = parseRow(tableLines[0]);
  const rows = tableLines.slice(2).map((line) => parseRow(line).map(parseCellElement));
  return { type: 'table', headers, rows };
}

// ─── Cell 標記格式解析（v2 新格式）────────────────────────────────────────────

const CELL_MARKER_RE = /^<!--\s*cell:r(\d+):(.+?)\s*-->$/;
const TABLE_META_RE = /^<!--\s*block:table\s+(.*?)\s*-->$/;
const STRUCT_MARKER_RE = /^<!--\s*(?:cell:|block:)\s*/;
const ANY_CELL_MARKER_RE = /^<!--\s*cell:/;

/**
 * 解析 cell 標記格式的表格（<!-- cell:rN:列名 -->）。
 * 輸出結構與 parseGfmTable 相同：{ type: 'table', headers, rows }
 */
export function parseCellFormatTable(raw, blockMeta) {
  const lines = raw.split('\n');
  const colsStr = blockMeta?.cols || '';
  const headers = colsStr ? colsStr.split(',').map((c) => c.trim()) : [];

  const rowMap = new Map();

  let currentRowNum = 0;
  let currentCellCol = null;
  let currentCellLines = [];
  let inCodeFence = false;

  const ensureRow = (rowNum) => {
    if (!rowMap.has(rowNum)) {
      rowMap.set(rowNum, headers.map(() => ({ elements: [{ type: 'text', markdown: '' }] })));
    }
    return rowMap.get(rowNum);
  };

  const flushCell = () => {
    if (currentCellCol == null || currentRowNum < 1) return;
    const cellText = currentCellLines.join('\n').trim();
    const row = ensureRow(currentRowNum);
    const colIndex = headers.indexOf(currentCellCol);
    if (colIndex >= 0) {
      row[colIndex] = parseCellContent(cellText);
    }
    currentCellCol = null;
    currentCellLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();

    if (inCodeFence) {
      if (/^```\s*$/.test(trimmed)) {
        inCodeFence = false;
      }
      currentCellLines.push(line);
      continue;
    }

    if (/^```\w*/.test(trimmed)) {
      inCodeFence = true;
      currentCellLines.push(line);
      continue;
    }

    const cellMatch = trimmed.match(CELL_MARKER_RE);
    if (cellMatch) {
      flushCell();
      currentRowNum = Number(cellMatch[1]);
      currentCellCol = cellMatch[2];
      currentCellLines = [];
      continue;
    }

    if (STRUCT_MARKER_RE.test(trimmed) && !ANY_CELL_MARKER_RE.test(trimmed)) {
      break;
    }

    if (currentCellCol != null) {
      currentCellLines.push(line);
    }
  }
  flushCell();

  const maxRow = rowMap.size ? Math.max(...rowMap.keys()) : 0;
  const rows = [];
  for (let r = 1; r <= maxRow; r++) {
    rows.push(ensureRow(r));
  }

  return { type: 'table', headers, rows };
}

const LIST_LINE_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)\s/;
const MERMAID_FENCE_PARA_RE = /^```mermaid\s*\n([\s\S]*?)```\s*$/;

/**
 * 解析格內內容：以空行分段，每段呼叫 parseSingleElement，
 * 圖片獨立、Mermaid 圍欄、列表原生。
 * 連續列表行保持為單獨 element（與 GFM 解析的 <br> 分段行為一致）。
 */
function parseCellContent(text) {
  if (!text) {
    return { elements: [{ type: 'text', markdown: '' }] };
  }

  const elements = [];
  const segments = splitByCodeFences(text);

  for (const seg of segments) {
    if (seg.type === 'mermaid') {
      elements.push({ type: 'mermaid', code: seg.code });
      continue;
    }

    const paragraphs = seg.text.split(/\n\n+/).map((p) => p.trim()).filter(Boolean);
    for (const para of paragraphs) {
      const lines = para.split('\n');
      if (lines.every((l) => LIST_LINE_RE.test(l) || !l.trim())) {
        for (const line of lines) {
          const trimmed = line.trimEnd();
          if (!trimmed) continue;
          const el = parseSingleElement(trimmed);
          if (el.type !== 'text') {
            elements.push(el);
          } else {
            const split = splitMarkdownByInlineImages(el.markdown ?? '');
            elements.push(...split);
          }
        }
      } else {
        const el = parseSingleElement(para);
        if (el.type !== 'text') {
          elements.push(el);
        } else {
          const split = splitMarkdownByInlineImages(el.markdown ?? '');
          elements.push(...split);
        }
      }
    }
  }

  return { elements: elements.length ? elements : [{ type: 'text', markdown: '' }] };
}

/**
 * 把文本按 ```mermaid 圍欄切分成 text 段和 mermaid 段，
 * 避免圍欄內容被段落分割邏輯誤切。
 */
function splitByCodeFences(text) {
  const segments = [];
  const lines = text.split('\n');
  let i = 0;
  let textBuf = [];

  while (i < lines.length) {
    if (/^```mermaid\s*$/.test(lines[i].trim())) {
      if (textBuf.length) {
        segments.push({ type: 'text', text: textBuf.join('\n') });
        textBuf = [];
      }
      const codeLines = [];
      i++;
      while (i < lines.length && !/^```\s*$/.test(lines[i].trim())) {
        codeLines.push(lines[i]);
        i++;
      }
      segments.push({ type: 'mermaid', code: codeLines.join('\n').trim() });
      i++;
    } else {
      textBuf.push(lines[i]);
      i++;
    }
  }
  if (textBuf.length) {
    segments.push({ type: 'text', text: textBuf.join('\n') });
  }
  return segments;
}

/**
 * 檢測 raw 文本是否為 cell 標記格式（<!-- cell:rN:列名 -->）
 */
export function isCellFormat(raw) {
  return raw.split('\n').some((l) => CELL_MARKER_RE.test(l.trim()));
}

/**
 * 從 block:table 標記行解析 meta 屬性（cols 等）
 * 向下兼容：若舊格式含 id="..." 會忽略。
 */
export function parseTableBlockMeta(markerLine) {
  const match = markerLine.match(TABLE_META_RE);
  if (!match) return null;
  const attrs = match[1];
  const meta = {};
  const colsMatch = attrs.match(/cols="([^"]+)"/);
  if (colsMatch) meta.cols = colsMatch[1];
  return Object.keys(meta).length ? meta : null;
}
