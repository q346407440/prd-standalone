/**
 * prd-parser.js
 * 把 prd.md 解析成扁平的 Block[] 陣列。
 *
 * 新格式：結構化塊（table / mermaid / mindmap / divider / prd-section / link-list）保留 `<!-- block:type -->`；
 * 標題與段落為**原生 Markdown**（無 `<!-- block:h* -->` / `<!-- block:paragraph -->`），解析為 h1–h7 / paragraph Block。
 * 舊格式（v1）：無 block 標記，自動遷移為 Block[]。
 *
 * Block 結構：
 *   { id: string, type: BlockType, content: Element }
 *
 * BlockType 及其 content（Element）：
 *   h1 / ... / h7     → { type: 'text', markdown: string }
 *   paragraph       → { type: 'text', markdown: string }
 *                      | { type: 'image', src: string, alt?: string }
 *   table           → { type: 'table', headers: string[], rows: CellElement[][] }
 *   divider         → { type: 'divider' }
 *   mermaid         → { type: 'mermaid', code: string }
 *   mindmap         → { type: 'mindmap', code: string }
 *
 * CellElement：
 *   { element: { type: 'text', markdown: string } | { type: 'image', src: string, alt?: string } | { type: 'mermaid', code: string } | { type: 'mindmap', code: string } }
 */

import {
  parseGfmTable,
  parseCellFormatTable,
  isCellFormat,
} from './prd-table-parser.js';
import { migrateFromLegacy } from './prd-legacy-migration.js';
import { createImageElement, parseMarkdownImage } from './prd-image-markdown.js';
import {
  BLOCK_OPENING_LINE_RE,
  BLOCK_END_LINE_RE,
  isIslandBlockType,
} from './prd-island-block-markers.js';
import { normalizePrdMdForLoad } from './prd-md-normalize.js';
import { parseProseRegionToBlocks } from './prd-prose-mdast.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

/** 仍以 block 起始行 + 正文區掃描的類型（不含 h1–h7、paragraph） */
const STRUCTURED_BLOCK_TYPES = new Set([
  'table', 'mermaid', 'mindmap', 'divider', 'prd-section', 'link-list',
]);
const HEADING_BLOCK_RE = /^h([1-7])$/;

const SECTION_MARKERS = {
  design: '<!-- section:design -->',
  interaction: '<!-- section:interaction -->',
  logic: '<!-- section:logic -->',
  end: '<!-- section:end -->',
};

const MERMAID_FENCE_RE = /^```mermaid\s*\n([\s\S]*?)```\s*$/;
const BARE_LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)$/;

let _idCounter = 0;
function genId() {
  return `blk-${Date.now()}-${++_idCounter}`;
}

// ─── 工具函數 ────────────────────────────────────────────────────────────────

function trimLines(str) {
  const lines = String(str)
    .split('\n')
    .map((l) => l.trimEnd());
  let start = 0;
  let end = lines.length - 1;
  while (start <= end && !lines[start].trim()) start += 1;
  while (end >= start && !lines[end].trim()) end -= 1;
  return lines.slice(start, end + 1).join('\n');
}

function normalizeBareListPrefix(text) {
  if (!text) return text;
  const match = text.match(BARE_LIST_PREFIX_RE);
  if (!match) return text;
  return `${match[1]}${match[2]} `;
}

function parseLinks(block) {
  const RE = /\[([^\]]+)\]\(([^)]+)\)/g;
  const links = [];
  let m;
  while ((m = RE.exec(block)) !== null) {
    links.push({ text: m[1], url: m[2] });
  }
  return links;
}

function extractBetween(text, startMarker, endMarkers) {
  const start = text.indexOf(startMarker);
  if (start < 0) return '';
  const afterStart = text.slice(start + startMarker.length);
  let end = afterStart.length;
  for (const em of endMarkers) {
    const idx = afterStart.indexOf(em);
    if (idx >= 0 && idx < end) end = idx;
  }
  return afterStart.slice(0, end).trim();
}

// ─── 新格式解析（v2）────────────────────────────────────────────────────────

function isStructuredBlockType(t) {
  return STRUCTURED_BLOCK_TYPES.has(t);
}

/** v1 舊稿哨兵（與 prd-legacy-migration 一致） */
const LEGACY_PRD_SECTIONS_MARKER = '<!-- prd:sections -->';

/**
 * 是否走混合解析（結構化 block + 原生 prose），而非 migrateFromLegacy。
 */
function isNewFormat(mdText) {
  if (!mdText || typeof mdText !== 'string') return false;
  if (mdText.includes(LEGACY_PRD_SECTIONS_MARKER)) return false;
  for (const line of mdText.split('\n')) {
    if (BLOCK_OPENING_LINE_RE.test(line.trim())) return true;
  }
  if (/<!--\s*\/block:(table|mermaid|mindmap)\s*-->/.test(mdText)) return true;
  if (/<!--\s*cell:r\d+:/i.test(mdText)) return true;
  if (/^#{1,6}\s+/m.test(mdText)) return true;
  // 无 v1 分区哨兵时，非空正文一律走 hybrid + remark，避免仅含段落的 v2 稿误进 migrateFromLegacy
  if (mdText.trim().length > 0) return true;
  return false;
}

/**
 * 島塊 + 中間 prose：prose 用 remark 轉成 h* / paragraph / divider。
 */
function parseHybridFormat(mdText) {
  const lines = mdText.split('\n');
  const blocks = [];

  let proseLines = [];
  let currentType = null;
  let currentMeta = null;
  let currentLines = [];

  const flushProse = () => {
    const raw = proseLines.join('\n');
    proseLines = [];
    const t = trimLines(raw);
    if (!t) return;
    blocks.push(...parseProseRegionToBlocks(t));
  };

  const flushStructured = () => {
    if (!currentType) return;
    const raw = currentLines.join('\n');
    const block = parseBlockContent(currentType, raw, currentMeta);
    if (block) blocks.push(block);
    currentType = null;
    currentMeta = null;
    currentLines = [];
  };

  for (const line of lines) {
    const trimmed = line.trim();
    const endMatch = trimmed.match(BLOCK_END_LINE_RE);
    if (
      currentType !== null
      && endMatch
      && isIslandBlockType(currentType)
      && endMatch[1] === currentType
    ) {
      flushStructured();
      continue;
    }

    const markerMatch = trimmed.match(BLOCK_OPENING_LINE_RE);
    if (markerMatch) {
      const t = markerMatch[1];
      if (isStructuredBlockType(t)) {
        flushProse();
        flushStructured();
        currentType = t;
        currentMeta = markerMatch[2] ? parseBlockMarkerAttrs(markerMatch[2]) : null;
        currentLines = [];
        continue;
      }
      if (currentType !== null) {
        currentLines.push(line);
      } else {
        proseLines.push(line);
      }
      continue;
    }

    if (currentType === 'divider') {
      // divider 块只吞 `---` 与紧随的空行；其后 prose 须回到 remark 解析（避免吞掉 ### / ####）
      if (trimmed === '---' || trimmed === '') {
        currentLines.push(line);
        continue;
      }
      flushStructured();
    }

    if (currentType !== null) {
      currentLines.push(line);
    } else {
      proseLines.push(line);
    }
  }

  flushStructured();
  flushProse();

  return blocks;
}

function parseBlockMarkerAttrs(attrsStr) {
  if (!attrsStr) return null;
  const meta = {};
  const colsMatch = attrsStr.match(/cols="([^"]+)"/);
  if (colsMatch) meta.cols = colsMatch[1];
  return Object.keys(meta).length ? meta : null;
}

function parseBlockContent(type, raw, meta) {
  const text = trimLines(raw);
  const headingMatch = type.match(HEADING_BLOCK_RE);
  if (headingMatch) {
    const level = Number(headingMatch[1]);
    const headingText = text.replace(new RegExp(`^#{1,${level}}\\s*`), '').trim();
    return { id: genId(), type, content: { type: 'text', markdown: headingText } };
  }

  switch (type) {
    case 'paragraph': {
      const normalizedText = normalizeBareListPrefix(text);
      const image = parseMarkdownImage(normalizedText);
      if (image) {
        return { id: genId(), type: 'paragraph', content: createImageElement(image.src, image.alt) };
      }
      return { id: genId(), type: 'paragraph', content: { type: 'text', markdown: normalizedText } };
    }

    case 'divider': {
      return { id: genId(), type: 'divider', content: { type: 'divider' } };
    }

    case 'mermaid': {
      const fenceMatch = text.match(MERMAID_FENCE_RE);
      const code = fenceMatch ? fenceMatch[1].trimEnd() : text;
      return { id: genId(), type: 'mermaid', content: { type: 'mermaid', code } };
    }

    case 'mindmap': {
      return { id: genId(), type: 'mindmap', content: { type: 'mindmap', code: text } };
    }

    case 'table': {
      if (isCellFormat(raw)) {
        const tableContent = parseCellFormatTable(raw, meta);
        return { id: genId(), type: 'table', content: tableContent };
      }
      const tableStart = text.indexOf('|');
      if (tableStart < 0) {
        return { id: genId(), type: 'table', content: { type: 'table', headers: [], rows: [] } };
      }
      return { id: genId(), type: 'table', content: parseGfmTable(text.slice(tableStart)) };
    }

    case 'link-list': {
      const firstLine = text.split('\n')[0] || '';
      const title = firstLine.replace(/^#{1,3}\s*/, '').trim();
      const links = parseLinks(text);
      const parts = [];
      if (title) parts.push(`## ${title}`);
      for (const { text: t, url } of links) {
        parts.push(`[${t}](${url})`);
      }
      return { id: genId(), type: 'paragraph', content: { type: 'text', markdown: parts.join('\n\n') } };
    }

    case 'prd-section': {
      const titleMatch = text.match(/^##\s+(.+)/m);
      const title = titleMatch ? titleMatch[1].trim() : '';
      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '');

      const design = extractBetween(raw, SECTION_MARKERS.design, [
        SECTION_MARKERS.interaction,
        SECTION_MARKERS.logic,
        SECTION_MARKERS.end,
      ]);
      const interaction = extractBetween(raw, SECTION_MARKERS.interaction, [
        SECTION_MARKERS.logic,
        SECTION_MARKERS.end,
      ]);
      const logic = extractBetween(raw, SECTION_MARKERS.logic, [SECTION_MARKERS.end]);

      const imgMatch = design.match(/!\[[^\]]*\]\(([^)]+)\)/);
      const designImage = imgMatch ? imgMatch[1] : '';

      return {
        id: genId(),
        type: 'prd-section',
        content: {
          sectionId: id || genId(),
          title,
          designImage,
          interactionMarkdown: trimLines(interaction),
          logicMarkdown: trimLines(logic),
        },
      };
    }

    default:
      return null;
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 解析 prd.md 文字，回傳 Block[]。
 * 入參先經 normalizePrdMdForLoad（island end + 剥除舊 prose block 行）；再識別新格式或 v1 legacy。
 */
export function parsePrd(mdText) {
  if (mdText == null || mdText === '') return [];
  const input = normalizePrdMdForLoad(String(mdText));
  if (isNewFormat(input)) {
    return parseHybridFormat(input);
  }
  return migrateFromLegacy(input);
}
