import { cellFromMarkdownString } from './prd-inline-image-split.js';
import { PRD_SECTION_HEADERS } from './prd-constants.js';
import { genId, cloneSerializable } from './prd-utils.js';
import {
  createTypedMarkdownListOptions,
  parseListPrefix,
  renumberOrderedGroupAt,
  renumberOrderedItemsFrom,
} from './prd-list-utils.js';

export const makeEmptyCell = () => ({ elements: [{ type: 'text', markdown: '' }] });
export const makeEmptyRow = (colCount) => Array(colCount).fill(null).map(makeEmptyCell);

export function getBlockMd(block) {
  return block?.content?.markdown ?? '';
}

export function isMainDocTextListBlock(block) {
  if (!block) return false;
  if (/^h[1-7]$/.test(block.type)) return true;
  return block.type === 'paragraph' && block.content?.type === 'text';
}

export function getMainDocTextListType(block) {
  if (!block) return null;
  if (/^h[1-7]$/.test(block.type)) return block.type;
  if (block.type === 'paragraph' && block.content?.type === 'text') return block.type;
  return null;
}

export function setBlockMd(block, markdown) {
  const next = {
    ...block,
    content: {
      ...block.content,
      markdown,
    },
  };
  if (next.content?.type === 'text' && typeof markdown === 'string' && markdown.includes('\n')) {
    const { tightJoinPrev, ...rest } = next.content;
    if (tightJoinPrev !== undefined) {
      return { ...next, content: rest };
    }
  }
  return next;
}

/** 与 prd-prose-mdast 顶层列表拆行一致：单行 + 无序/有序列表前缀 */
const TIGHT_LIST_ITEM_BODY_RE = /^( {0,3})([*+-]|\d+\.)\s+\S/;

function isSingleLineTightListItemMarkdown(md) {
  const m = String(md ?? '').replace(/\s+$/, '');
  if (!m || m.includes('\n') || m.includes('```')) return false;
  return TIGHT_LIST_ITEM_BODY_RE.test(m);
}

/** 单行 `**标题**` 式小标题，常与下接 `* ` 列表无空行连用 */
function isSingleLineBoldTitleLine(md) {
  const t = String(md ?? '').trim();
  if (!t || t.includes('\n')) return false;
  return /^\*\*[^*\n]+\*\*$/.test(t);
}

/**
 * 按当前 block 顺序重算 `content.tightJoinPrev`：列表项与上一列表项、或与上一「单行 **标题** / 列表」前言段之间用单换行拼接。
 * 在移动、插入、删除等改变顺序后调用，避免序列化误插入空行。
 */
export function reconcileTightJoinPrevForParagraphRuns(blocks) {
  const list = blocks || [];
  const out = [];
  for (const b of list) {
    if (b.type !== 'paragraph' || b.content?.type !== 'text') {
      out.push(b);
      continue;
    }
    const prev = out[out.length - 1];
    const md = getBlockMd(b);
    const prevMd = prev?.type === 'paragraph' && prev.content?.type === 'text'
      ? getBlockMd(prev)
      : '';
    const shouldTight = prev
      && prev.type === 'paragraph'
      && prev.content?.type === 'text'
      && isSingleLineTightListItemMarkdown(md)
      && !String(md).includes('\n')
      && !String(prevMd).includes('\n')
      && (
        isSingleLineTightListItemMarkdown(prevMd)
        || isSingleLineBoldTitleLine(prevMd)
      );
    if (shouldTight) {
      out.push({
        ...b,
        content: { ...b.content, tightJoinPrev: true },
      });
    } else if (b.content?.tightJoinPrev !== undefined) {
      const { tightJoinPrev, ...rest } = b.content;
      out.push({ ...b, content: rest });
    } else {
      out.push(b);
    }
  }
  return out;
}

export function shouldSkipMainDocListBlock(block) {
  return !isMainDocTextListBlock(block);
}

export function createMainDocTextListOptions(anchorBlock) {
  return createTypedMarkdownListOptions({
    anchorItem: anchorBlock,
    getMarkdown: getBlockMd,
    setMarkdown: setBlockMd,
    getItemType: getMainDocTextListType,
    shouldSkipItem: shouldSkipMainDocListBlock,
  });
}

export function renumberMainDocTextListAt(blocks, blockIdx) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return blocks;
  return renumberOrderedGroupAt(blocks, blockIdx, createMainDocTextListOptions(anchorBlock));
}

export function renumberMainDocTextListFrom(blocks, blockIdx, startNum) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return blocks;
  const md = getBlockMd(anchorBlock);
  const parsed = parseListPrefix(md);
  if (!parsed) return blocks;
  const opts = createMainDocTextListOptions(anchorBlock);
  const result = renumberOrderedItemsFrom(blocks, blockIdx, parsed.indent, startNum, opts);
  return result ?? blocks;
}

export function isOrderedMainDocTextListAt(blocks, blockIdx) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return false;
  const parsed = parseListPrefix(getBlockMd(anchorBlock));
  return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

export function maybeRenumberMainDocTextListAt(blocks, blockIdx) {
  if (!isOrderedMainDocTextListAt(blocks, blockIdx)) return blocks;
  return renumberMainDocTextListAt(blocks, blockIdx);
}

export function makeDefaultBlock(type) {
  const id = genId();
  switch (type) {
    case 'h1': return { id, type, content: { type: 'text', markdown: '新标题' } };
    case 'h2': return { id, type, content: { type: 'text', markdown: '新 H2 标题' } };
    case 'h3': return { id, type, content: { type: 'text', markdown: '新 H3 标题' } };
    case 'h4': return { id, type, content: { type: 'text', markdown: '新 H4 标题' } };
    case 'h5': return { id, type, content: { type: 'text', markdown: '新 H5 标题' } };
    case 'h6': return { id, type, content: { type: 'text', markdown: '新 H6 标题' } };
    case 'h7': return { id, type, content: { type: 'text', markdown: '新 H7 标题' } };
    case 'paragraph': return { id, type, content: { type: 'text', markdown: '' } };
    case 'divider': return { id, type, content: { type: 'divider' } };
    case 'mermaid': return { id, type, content: { type: 'mermaid', code: 'graph LR\n  A[开始] --> B[结束]' } };
    case 'mindmap': return { id, type, content: { type: 'mindmap', code: '- 主题\n  - 分支1\n  - 分支2' } };
    case 'table': return {
      id, type,
      content: {
        type: 'table',
        headers: ['列1', '列2', '列3'],
        rows: [makeEmptyRow(3)],
      },
    };
    default: return { id, type: 'paragraph', content: { type: 'text', markdown: '' } };
  }
}

export function cloneBlockWithNewId(block) {
  return {
    ...cloneSerializable(block),
    id: genId(),
  };
}

/**
 * 复制块插入后应落在的选区形态（与标题/段落 Tiptap、段落图、图表块各处一致）。
 * divider、table 等无对应全局选区时返回 null，由调用方清选区并另设操作栏锚点。
 * @param {object} block
 * @returns {object | null}
 */
export function globalSelectionForDuplicatedBlock(block) {
  if (!block?.id) return null;
  const t = block.type;
  if (/^h[1-7]$/.test(t)) {
    return {
      type: 'text-block',
      blockId: block.id,
      role: 'heading',
      cellPath: null,
    };
  }
  if (t === 'paragraph') {
    if (block.content?.type === 'image') {
      return { type: 'image', blockId: block.id, cellPath: null };
    }
    return {
      type: 'text-block',
      blockId: block.id,
      role: 'paragraph',
      cellPath: null,
    };
  }
  if (t === 'mermaid' || t === 'mindmap') {
    return { type: 'diagram', blockId: block.id };
  }
  return null;
}

export function makePrdSectionTemplateBlocks() {
  const heading = { id: genId(), type: 'h2', content: { type: 'text', markdown: '新章节' } };
  const table = {
    id: genId(),
    type: 'table',
    content: {
      type: 'table',
      headers: [...PRD_SECTION_HEADERS],
      rows: [makeEmptyRow(PRD_SECTION_HEADERS.length)],
    },
  };
  return [heading, table];
}

/**
 * 將「單一 block:paragraph 內含多段 GFM 段落（\\n\\n）」拆成多個 paragraph block，
 * 與編輯器內 Enter 拆 block、序列化後多個 <!-- block:paragraph --> 的結構對齊。
 *
 * 含 ``` 圍欄的段落不拆，避免誤切 code fence。
 */
export function expandParagraphBlocksOnBlankLines(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type !== 'paragraph' || block.content?.type !== 'text') {
      out.push(block);
      continue;
    }
    const md = block.content.markdown ?? '';
    if (!md.includes('\n\n') || md.includes('```')) {
      out.push(block);
      continue;
    }
    const parts = md
      .split(/\n\n+/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0);
    if (parts.length <= 1) {
      out.push(block);
      continue;
    }
    parts.forEach((part, i) => {
      out.push({
        ...block,
        id: i === 0 ? block.id : genId(),
        content: { type: 'text', markdown: part },
      });
    });
  }
  return reconcileTightJoinPrevForParagraphRuns(out);
}

export function normalizeLegacyBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type === 'prd-section') {
      const { title, designImage, interactionMarkdown, logicMarkdown } = block.content || {};
      out.push({ id: genId(), type: 'h2', content: { type: 'text', markdown: title || '新章节' } });
      const toCell = (v) => {
        if (!v) return makeEmptyCell();
        return cellFromMarkdownString(v);
      };
      out.push({
        id: genId(),
        type: 'table',
        content: {
          type: 'table',
          headers: [...PRD_SECTION_HEADERS],
          rows: [[toCell(designImage), toCell(interactionMarkdown), toCell(logicMarkdown)]],
        },
      });
    } else if (block.type === 'link-list') {
      const { title, links } = block.content || {};
      const parts = [];
      if (title) parts.push(`## ${title}`);
      for (const { text, url } of links || []) {
        parts.push(`[${text}](${url})`);
      }
      out.push({
        id: block.id,
        type: 'paragraph',
        content: { type: 'text', markdown: parts.join('\n\n') },
      });
    } else {
      out.push(block);
    }
  }
  return out;
}
