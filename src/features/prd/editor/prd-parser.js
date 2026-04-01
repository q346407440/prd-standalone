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

// ─── 常量 ────────────────────────────────────────────────────────────────────

const BLOCK_MARKER_RE = /^<!--\s*block:([\w-]+)\s*-->$/;
const HEADING_BLOCK_RE = /^h([1-7])$/;

const SECTION_MARKERS = {
  design: '<!-- section:design -->',
  interaction: '<!-- section:interaction -->',
  logic: '<!-- section:logic -->',
  end: '<!-- section:end -->',
};

// 舊格式標記（用於遷移檢測）
const LEGACY_SECTIONS_START = '<!-- prd:sections -->';

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

/** 判斷字串是否為純圖片 markdown：![alt](src) */
const PURE_IMAGE_RE = /^!\[([^\]]*)\]\(([^)]+)\)$/;
const MERMAID_FENCE_RE = /^```mermaid\s*\n([\s\S]*?)```\s*$/;
const CELL_MERMAID_RE = /^:::mermaid:::([\s\S]*?):::end-mermaid:::$/;
const CELL_MINDMAP_RE = /^:::mindmap:::([\s\S]*?):::end-mindmap:::$/;
const BARE_LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)$/;

function normalizeBareListPrefix(text) {
  if (!text) return text;
  const match = text.match(BARE_LIST_PREFIX_RE);
  if (!match) return text;
  return `${match[1]}${match[2]} `;
}

function parseSingleElement(s) {
  const mermaidMatch = s.match(CELL_MERMAID_RE);
  if (mermaidMatch) return { type: 'mermaid', code: mermaidMatch[1] };
  const mindmapMatch = s.match(CELL_MINDMAP_RE);
  if (mindmapMatch) return { type: 'mindmap', code: mindmapMatch[1] };
  const normalized = normalizeBareListPrefix(s);
  const imgMatch = normalized.match(PURE_IMAGE_RE);
  if (imgMatch) return { type: 'image', src: imgMatch[2] };
  return { type: 'text', markdown: normalized };
}

/**
 * 把單元格字串解析為 CellElement。
 * 格內多個段落以 <br> 或連續兩個換行分隔（Markdown 表格格內不能有真正換行，
 * 所以多段落以 <br> 表示）。
 * 回傳 { elements: Element[] }
 */
function parseCellElement(cellStr) {
  const s = (cellStr || '').trimEnd();
  // 以 <br> 分割多段（序列化時也用 <br>）
  const parts = s
    .split(/<br\s*\/?>/i)
    .map((p) => p.trimEnd())
    .filter((p) => p.trim() !== '');
  if (parts.length === 0) {
    return { elements: [{ type: 'text', markdown: '' }] };
  }
  return { elements: parts.map(parseSingleElement) };
}

function parseGfmTable(block) {
  const lines = block
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
  const tableLines = lines.filter((l) => l.startsWith('|'));
  if (tableLines.length < 2) return { type: 'table', headers: [], rows: [] };

  const parseRow = (line) =>
    line
      .replace(/^\||\|$/g, '')
      .split('|')
      // Markdown 表格每格外側有 1 個對齊空格，僅去掉這層；保留內容本身的前導縮進。
      .map((c) => c.replace(/^ /, '').trimEnd());

  const headers = parseRow(tableLines[0]);
  const rows = tableLines.slice(2).map((line) => parseRow(line).map(parseCellElement));
  return { type: 'table', headers, rows };
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
  let currentLines = [];

  const flush = () => {
    if (!currentType) return;
    const raw = currentLines.join('\n');
    const block = parseBlockContent(currentType, raw);
    if (block) blocks.push(block);
    currentType = null;
    currentLines = [];
  };

  for (const line of lines) {
    const markerMatch = line.trim().match(BLOCK_MARKER_RE);
    if (markerMatch) {
      flush();
      currentType = markerMatch[1];
      currentLines = [];
    } else if (currentType !== null) {
      currentLines.push(line);
    }
  }
  flush();

  return blocks;
}

function parseBlockContent(type, raw) {
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
      // 純圖片段落 → image element
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

      // 舊的 prd-section 轉換為 h2 + table（由 normalizeLegacyBlocks 處理）
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

// ─── 舊格式遷移（v1 → Block[]）──────────────────────────────────────────────

function migrateFromLegacy(mdText) {
  const blocks = [];
  const lines = mdText.split('\n');

  const h1Line = lines.find((l) => /^# /.test(l));
  if (h1Line) {
    blocks.push({
      id: genId(),
      type: 'h1',
      content: { type: 'text', markdown: h1Line.replace(/^# /, '').trim() },
    });
  }

  const sectionsStartIdx = lines.findIndex((l) => l.trim() === LEGACY_SECTIONS_START);
  const overviewText = sectionsStartIdx >= 0
    ? lines.slice(0, sectionsStartIdx).join('\n')
    : mdText;
  const sectionsText = sectionsStartIdx >= 0
    ? lines.slice(sectionsStartIdx + 1).join('\n')
    : '';

  const h2Blocks = splitByH2(overviewText);
  for (const { title, body } of h2Blocks) {
    if (!title) continue;

    blocks.push({ id: genId(), type: 'h2', content: { type: 'text', markdown: title } });

    if (title === '需求概述') {
      const bgMatch = body.match(/###\s*目的\/背景\s*\n([\s\S]*)/);
      const bg = bgMatch ? trimLines(bgMatch[1]) : trimLines(body);
      if (bg) {
        blocks.push({ id: genId(), type: 'paragraph', content: { type: 'text', markdown: bg } });
      }
    } else if (title === '需求功能清单') {
      const tableStart = body.indexOf('|');
      if (tableStart >= 0) {
        blocks.push({
          id: genId(),
          type: 'table',
          content: parseGfmTable(body.slice(tableStart)),
        });
      }
    } else {
      const md = trimLines(body);
      if (md) {
        blocks.push({ id: genId(), type: 'paragraph', content: { type: 'text', markdown: md } });
      }
    }
  }

  blocks.push({ id: genId(), type: 'divider', content: { type: 'divider' } });

  if (sectionsText.trim()) {
    const sectionH2Blocks = splitByH2(sectionsText);
    for (const { title, body } of sectionH2Blocks) {
      if (!title) continue;

      const id = title
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
        .replace(/^-|-$/g, '');

      const design = extractBetween(body, SECTION_MARKERS.design, [
        SECTION_MARKERS.interaction,
        SECTION_MARKERS.logic,
        SECTION_MARKERS.end,
      ]);
      const interaction = extractBetween(body, SECTION_MARKERS.interaction, [
        SECTION_MARKERS.logic,
        SECTION_MARKERS.end,
      ]);
      const logic = extractBetween(body, SECTION_MARKERS.logic, [SECTION_MARKERS.end]);

      const imgMatch = design.match(/!\[[^\]]*\]\(([^)]+)\)/);
      const designImage = imgMatch ? imgMatch[1] : '';

      blocks.push({
        id: genId(),
        type: 'prd-section',
        content: {
          sectionId: id || genId(),
          title,
          designImage,
          interactionMarkdown: trimLines(interaction),
          logicMarkdown: trimLines(logic),
        },
      });
    }
  }

  return blocks;
}

function splitByH2(text) {
  const blocks = [];
  let current = null;
  for (const line of text.split('\n')) {
    const h2 = line.match(/^## (.+)/);
    if (h2) {
      if (current) blocks.push({ title: current.title, body: current.lines.join('\n') });
      current = { title: h2[1].trim(), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) blocks.push({ title: current.title, body: current.lines.join('\n') });
  return blocks;
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
