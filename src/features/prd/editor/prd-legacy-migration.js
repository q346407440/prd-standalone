import { parseGfmTable } from './prd-table-parser.js';

// ─── 常量 ────────────────────────────────────────────────────────────────────

const SECTION_MARKERS = {
  design: '<!-- section:design -->',
  interaction: '<!-- section:interaction -->',
  logic: '<!-- section:logic -->',
  end: '<!-- section:end -->',
};

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

// ─── 舊格式遷移（v1 → Block[]）──────────────────────────────────────────────

export function migrateFromLegacy(mdText) {
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

export function splitByH2(text) {
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
