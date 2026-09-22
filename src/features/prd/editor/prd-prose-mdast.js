/**
 * 将 prose 区段（无 `<!-- block:table -->` 等岛块标记）按 GFM 解析为 h1–h7 / paragraph / divider / **table**。
 * GFM 管道表（`| a | b |`）经 remark 的 `table` 节点 → `parseGfmTable` → `type: 'table'` 块，序列化即 cell 标记格式。
 * 按「双换行」分段；多顶层 mdast 子节点（如标题紧接表格）按顺序展开，不再整段压成单一 paragraph。
 */

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import remarkStringify from 'remark-stringify';
import { genId } from './prd-utils.js';
import { createImageElement, parseMarkdownImage } from './prd-image-markdown.js';
import { parseGfmTable } from './prd-table-parser.js';

const BARE_LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)$/;

/**
 * 从 mdast heading 提取纯标题（拼接 text / inlineCode 等叶子，不含 emphasis 的 ** 标记）。
 * `mdast-util-to-string` 对标题会输出 `**片段**` 形式的伪 markdown，存进 h* 块后再序列化易出现 `\\*` 转义脏标题。
 */
function mdastHeadingToPlainTitle(node) {
  if (!node || node.type !== 'heading') return '';
  function walk(n) {
    if (!n) return '';
    if (n.type === 'text') return n.value || '';
    if (n.type === 'inlineCode') return n.value || '';
    if (Array.isArray(n.children)) return n.children.map(walk).join('');
    return '';
  }
  let raw = walk(node).trim();
  // remark 常把「# **片段**后缀」收成单个 text，值为字面的 **…**；同时 toString 路径会产出 ** 包裹。统一剥掉成对 ** 得到可读标题。
  let prev;
  do {
    prev = raw;
    raw = raw.replace(/\*\*([^*]+)\*\*/g, '$1');
  } while (raw !== prev);
  return raw.trim();
}

/** 顶层列表项：至多 3 格缩进 + 无序或有序标记 + 正文（与 GFM 常见写法一致） */
const TIGHT_TOP_LIST_ITEM_LINE_RE = /^( {0,3})([*+-]|\d+\.)\s+\S.*$/;

/**
 * 整段均为「单换行分隔的顶层列表行」时拆成多个 paragraph，后者带 tightJoinPrev 以便序列化用 \n 拼回无空行列表。
 * @param {string} s
 * @returns {object[] | null}
 */
function trySplitTightTopLevelListItems(s) {
  const lines = s.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 2) return null;
  for (const line of lines) {
    if (!line.trim()) return null;
    if (!TIGHT_TOP_LIST_ITEM_LINE_RE.test(line)) return null;
  }
  if (s.includes('```')) return null;
  return lines.map((line, i) => ({
    id: genId(),
    type: 'paragraph',
    content: {
      type: 'text',
      markdown: line.replace(/\s+$/, ''),
      ...(i > 0 ? { tightJoinPrev: true } : {}),
    },
  }));
}

/**
 * 若干行「非列表」前言 + 其后连续顶层列表行（单换行、无空行），拆成 [前言 paragraph | 多条列表 paragraph…]，
 * 列表项均带 tightJoinPrev（首条与前言之间序列化用 \n）。
 * @param {string} s
 * @returns {object[] | null}
 */
function trySplitPreambleAndTightTopLevelList(s) {
  const lines = s.split('\n');
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  if (lines.length < 2) return null;
  if (s.includes('```')) return null;

  let firstListIdx = -1;
  for (let i = 0; i < lines.length; i += 1) {
    if (TIGHT_TOP_LIST_ITEM_LINE_RE.test(lines[i])) {
      firstListIdx = i;
      break;
    }
  }
  if (firstListIdx <= 0) return null;

  for (let i = 0; i < firstListIdx; i += 1) {
    if (!lines[i].trim()) return null;
    if (TIGHT_TOP_LIST_ITEM_LINE_RE.test(lines[i])) return null;
  }
  for (let j = firstListIdx; j < lines.length; j += 1) {
    if (!lines[j].trim()) return null;
    if (!TIGHT_TOP_LIST_ITEM_LINE_RE.test(lines[j])) return null;
  }

  const preamble = lines.slice(0, firstListIdx).join('\n').replace(/\s+$/, '');
  if (!preamble.trim()) return null;

  const out = [{
    id: genId(),
    type: 'paragraph',
    content: { type: 'text', markdown: preamble },
  }];
  for (let k = firstListIdx; k < lines.length; k += 1) {
    out.push({
      id: genId(),
      type: 'paragraph',
      content: {
        type: 'text',
        markdown: lines[k].replace(/\s+$/, ''),
        tightJoinPrev: true,
      },
    });
  }
  return out;
}

function normalizeBareListPrefix(text) {
  if (!text) return text;
  const match = text.match(BARE_LIST_PREFIX_RE);
  if (!match) return text;
  return `${match[1]}${match[2]} `;
}

function stringifyTopLevelNode(node) {
  try {
    return unified()
      .use(remarkStringify)
      .stringify({ type: 'root', children: [node] })
      .replace(/\s+$/, '');
  } catch {
    return '';
  }
}

/** 序列化單個 mdast 節點為 Markdown（含 GFM table），供 parseGfmTable 消費 */
function stringifyNodeWithGfm(node) {
  try {
    return unified()
      .use(remarkStringify)
      .use(remarkGfm)
      .stringify({ type: 'root', children: [node] })
      .replace(/\s+$/, '');
  } catch {
    return '';
  }
}

function mdastTableToPrdTableBlock(tableNode) {
  const gfm = stringifyNodeWithGfm(tableNode).trim();
  if (!gfm) return null;
  const content = parseGfmTable(gfm);
  const hasHeaders = Array.isArray(content.headers) && content.headers.length > 0;
  const hasRows = Array.isArray(content.rows) && content.rows.length > 0;
  if (!hasHeaders && !hasRows) return null;
  return { id: genId(), type: 'table', content };
}

/**
 * 將 remark 根下多個頂層 mdast 子節點展開為 PRD Block[]（含 GFM table → type:table）。
 */
function expandMdastChildrenToBlocks(kids) {
  const out = [];
  for (const child of kids || []) {
    if (!child) continue;
    if (child.type === 'heading') {
      const depth = Math.min(7, Math.max(1, Number(child.depth) || 1));
      const text = mdastHeadingToPlainTitle(child);
      if (text) {
        out.push({ id: genId(), type: `h${depth}`, content: { type: 'text', markdown: text } });
      }
      continue;
    }
    if (child.type === 'thematicBreak') {
      out.push({ id: genId(), type: 'divider', content: { type: 'divider' } });
      continue;
    }
    if (child.type === 'table') {
      const b = mdastTableToPrdTableBlock(child);
      if (b) out.push(b);
      continue;
    }
    if (child.type === 'paragraph') {
      const md = stringifyTopLevelNode(child).trim();
      if (!md) continue;
      const normalizedText = normalizeBareListPrefix(md);
      const image = parseMarkdownImage(normalizedText);
      if (image && /^\s*!\[[^\]]*]\([^)]+\)\s*$/.test(normalizedText)) {
        out.push({ id: genId(), type: 'paragraph', content: createImageElement(image.src, image.alt) });
      } else {
        out.push({
          id: genId(),
          type: 'paragraph',
          content: { type: 'text', markdown: normalizedText },
        });
      }
      continue;
    }
    if (child.type === 'code') {
      const lang = (child.lang || '').trim();
      const val = child.value ?? '';
      if (lang === 'mermaid') {
        out.push({ id: genId(), type: 'mermaid', content: { type: 'mermaid', code: val } });
      } else {
        const fence = lang ? `\`\`\`${lang}\n${val}\n\`\`\`` : `\`\`\`\n${val}\n\`\`\``;
        out.push({ id: genId(), type: 'paragraph', content: { type: 'text', markdown: fence } });
      }
      continue;
    }
    const fallback = stringifyNodeWithGfm(child).trim();
    if (fallback) {
      out.push({ id: genId(), type: 'paragraph', content: { type: 'text', markdown: fallback } });
    }
  }
  return out;
}

/**
 * @param {string} seg
 * @returns {object[]}
 */
function parseOneProseSegment(seg) {
  const s = String(seg || '').replace(/\r\n/g, '\n').replace(/\s+$/, '');
  if (!s.trim()) return [];

  const preambleThenList = trySplitPreambleAndTightTopLevelList(s);
  if (preambleThenList) return preambleThenList;

  const tightListOnly = trySplitTightTopLevelListItems(s);
  if (tightListOnly) return tightListOnly;

  let tree;
  try {
    tree = unified().use(remarkParse).use(remarkGfm).parse(s);
  } catch {
    return [{
      id: genId(),
      type: 'paragraph',
      content: { type: 'text', markdown: s.trim() },
    }];
  }

  const kids = tree.children || [];
  if (kids.length === 0) return [];

  if (kids.length === 1 && kids[0].type === 'heading') {
    const child = kids[0];
    const depth = Math.min(7, Math.max(1, Number(child.depth) || 1));
    const type = `h${depth}`;
    const text = mdastHeadingToPlainTitle(child);
    return [{ id: genId(), type, content: { type: 'text', markdown: text } }];
  }

  if (kids.length === 1 && kids[0].type === 'thematicBreak') {
    return [{ id: genId(), type: 'divider', content: { type: 'divider' } }];
  }

  if (kids.length === 1 && kids[0].type === 'paragraph') {
    const md = stringifyTopLevelNode(kids[0]);
    const n = md.trim();
    if (!n) return [];
    const normalizedText = normalizeBareListPrefix(n);
    const image = parseMarkdownImage(normalizedText);
    if (image && /^\s*!\[[^\]]*]\([^)]+\)\s*$/.test(normalizedText)) {
      return [{ id: genId(), type: 'paragraph', content: createImageElement(image.src, image.alt) }];
    }
    return [{
      id: genId(),
      type: 'paragraph',
      content: { type: 'text', markdown: normalizedText },
    }];
  }

  if (kids.length === 1 && kids[0].type === 'table') {
    const b = mdastTableToPrdTableBlock(kids[0]);
    return b ? [b] : [];
  }

  // 僅在「含表格」或「多頂層節點」時展開；單一 list/blockquote 等仍走下方整段回退，避免 remark stringify 改寫列表前綴（如 `  - ` → `*`）。
  const hasTable = kids.some((k) => k?.type === 'table');
  if (kids.length > 1 || hasTable) {
    const expanded = expandMdastChildrenToBlocks(kids);
    if (expanded.length) return expanded;
  }

  return [{
    id: genId(),
    type: 'paragraph',
    content: { type: 'text', markdown: s },
  }];
}

/**
 * @param {string} sourceMd
 * @returns {object[]}
 */
export function parseProseRegionToBlocks(sourceMd) {
  const raw = String(sourceMd || '').replace(/\r\n/g, '\n');
  if (!raw.trim()) return [];

  const trimmedOuter = raw.replace(/^\n+|\n+$/g, '');
  const segments = trimmedOuter.split(/\n\n+/);

  const out = [];
  for (const seg of segments) {
    out.push(...parseOneProseSegment(seg));
  }
  return out;
}
