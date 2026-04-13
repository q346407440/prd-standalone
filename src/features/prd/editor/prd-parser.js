/**
 * prd-parser.js
 * 把 prd.md 解析成扁平的 Block[] 陣列。
 *
 * 新格式（v2）：每個 Block 前有 <!-- block:type --> 標記。
 * 舊格式（v1）：無 block 標記，自動遷移為 Block[]。
 *
 * Block 結構：
 *   { id: string, type: BlockType, content: Element }
 *
 * BlockType 及其 content（Element）：
 *   h1 / ... / h7     → { type: 'text', markdown: string }
 *   paragraph       → { type: 'text', markdown: string }
 *                      | { type: 'image', src: string }
 *   table           → { type: 'table', headers: string[], rows: CellElement[][] }
 *   divider         → { type: 'divider' }
 *   mermaid         → { type: 'mermaid', code: string }
 *   mindmap         → { type: 'mindmap', code: string }
 *
 * CellElement：
 *   { element: { type: 'text', markdown: string } | { type: 'image', src: string } | { type: 'mermaid', code: string } | { type: 'mindmap', code: string } }
 */

import {
  parseGfmTable,
  parseCellFormatTable,
  isCellFormat,
  parseTableBlockMeta,
} from './prd-table-parser.js';
import { migrateFromLegacy } from './prd-legacy-migration.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const BLOCK_MARKER_RE = /^<!--\s*block:([\w-]+)\s*-->$/;
const BLOCK_MARKER_WITH_ATTRS_RE = /^<!--\s*block:([\w-]+)(?:\s+(.*?))?\s*-->$/;
const HEADING_BLOCK_RE = /^h([1-7])$/;

const SECTION_MARKERS = {
  design: '<!-- section:design -->',
  interaction: '<!-- section:interaction -->',
  logic: '<!-- section:logic -->',
  end: '<!-- section:end -->',
};

const PURE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const MERMAID_FENCE_RE = /^```mermaid\s*\n([\s\S]*?)```\s*$/;
const BARE_LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)$/;

let _idCounter = 0;
function genId() {
  return `blk-${Date.now()}-${++_idCounter}`;
}

// ─── 工具函數 ────────────────────────────────────────────────────────────────

function trimLines(str) {
  return str
    .split('\n')
    .map((l) => l.trimEnd())
    .join('\n')
    .trim();
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

function isNewFormat(mdText) {
  return BLOCK_MARKER_RE.test(mdText.split('\n').find((l) => BLOCK_MARKER_RE.test(l.trim())) || '');
}

function parseNewFormat(mdText) {
  const lines = mdText.split('\n');
  const blocks = [];

  let currentType = null;
  let currentMeta = null;
  let currentLines = [];

  const flush = () => {
    if (!currentType) return;
    const raw = currentLines.join('\n');
    const block = parseBlockContent(currentType, raw, currentMeta);
    if (block) blocks.push(block);
    currentType = null;
    currentMeta = null;
    currentLines = [];
  };

  for (const line of lines) {
    const markerMatch = line.trim().match(BLOCK_MARKER_WITH_ATTRS_RE);
    if (markerMatch) {
      flush();
      currentType = markerMatch[1];
      currentMeta = markerMatch[2] ? parseBlockMarkerAttrs(markerMatch[2]) : null;
      currentLines = [];
    } else if (currentType !== null) {
      currentLines.push(line);
    }
  }
  flush();

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
      const imgMatch = normalizedText.match(PURE_IMAGE_RE);
      if (imgMatch) {
        return { id: genId(), type: 'paragraph', content: { type: 'image', src: imgMatch[2] } };
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
 * 自動識別新格式（v2）或舊格式（v1），舊格式自動遷移。
 */
export function parsePrd(mdText) {
  if (isNewFormat(mdText)) {
    return parseNewFormat(mdText);
  }
  return migrateFromLegacy(mdText);
}
