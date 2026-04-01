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
  return {
    ...block,
    content: {
      ...block.content,
      markdown,
    },
  };
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

export function normalizeLegacyBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type === 'prd-section') {
      const { title, designImage, interactionMarkdown, logicMarkdown } = block.content || {};
      out.push({ id: genId(), type: 'h2', content: { type: 'text', markdown: title || '新章节' } });
      const toCell = (v) => {
        if (!v) return makeEmptyCell();
        const imgMatch = v.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imgMatch) return { elements: [{ type: 'image', src: imgMatch[2] }] };
        return { elements: [{ type: 'text', markdown: v }] };
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
