/**
 * prd-export-native-md.js
 *
 * 把 Block[] 序列化成「原生 Markdown」：
 * 1. 去掉所有 <!-- block:type --> 标记。
 * 2. 表格输出为 GFM pipe table；cell 内换行用 <br>。
 * 3. 表格 cell 内的 mermaid / mindmap 不能放进原生 GFM table，
 *    抽到该 table 之后，按行优先（左到右、上到下）顺序排列。
 *    cell 内若同时有图片或文字（非 mermaid/mindmap），按 PRD 原写法保留在 cell 中。
 * 4. 顶层 mermaid 输出 ```mermaid 围栏；顶层 mindmap 输出原始缩进列表（与 Cursor MD 预览一致）。
 */

const LIST_LINE_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)\s/;

/**
 * 把所有 PRD 图片路径规范化为 `./assets/...`，让导出的 MD 在普通编辑器
 * （Typora / VSCode 预览 / Obsidian / GitHub 等）双击 / 上传后能直接显示图片。
 * 兼容三种输入：
 *   1) /prd/<file>                    旧的全局公共目录（迁移期遗留）
 *   2) /pages/doc-XXX/assets/<file>   浏览器 URL 形式
 *   3) ./assets/<file>                已经是新格式，无需变化
 */
export function rewritePrdAssetPathsForNativeMd(md) {
  if (typeof md !== 'string' || md.length === 0) return md;
  return md
    .replace(/\/pages\/doc-\d+\/assets\//g, './assets/')
    .replace(/\/prd\//g, './assets/');
}

function isInlineSuffix(text) {
  if (!text) return false;
  return !LIST_LINE_RE.test(text) && !text.startsWith('**') && !text.startsWith('![');
}

function escapeCellInline(text) {
  if (!text) return '';
  return text.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * 把单个 element 序列化成 cell 内的一段字符串。
 * mermaid / mindmap 返回 '' —— 调用方应当先把它们抽出去。
 */
function serializeCellElementForGfm(element) {
  if (!element) return '';
  if (element.type === 'mermaid' || element.type === 'mindmap') return '';
  if (element.type === 'image') return `![](${element.src})`;
  return element.markdown || '';
}

/**
 * 与 prd-writer.js 的 mergeInlineImageFragments 同源，
 * 但仅返回逻辑行字符串，且跳过 mermaid / mindmap 元素。
 */
function mergeCellLinesForGfm(elements) {
  const lines = [];
  let i = 0;
  while (i < elements.length) {
    const el = elements[i];
    if (!el) { i++; continue; }
    if (el.type === 'mermaid' || el.type === 'mindmap') { i++; continue; }

    if (el.type === 'image') {
      const parts = [`![](${el.src})`];
      i++;
      while (i < elements.length && elements[i]?.type === 'text' && isInlineSuffix(elements[i].markdown)) {
        parts.push(elements[i].markdown);
        i++;
      }
      lines.push(parts.join(''));
      continue;
    }

    const md = el.markdown || '';
    if (!md) { i++; continue; }

    const parts = [md];
    i++;
    while (i < elements.length && elements[i]?.type === 'image') {
      parts.push(`![](${elements[i].src})`);
      i++;
      while (i < elements.length && elements[i]?.type === 'text' && isInlineSuffix(elements[i].markdown)) {
        parts.push(elements[i].markdown);
        i++;
      }
    }
    lines.push(parts.join(''));
  }
  return lines;
}

/**
 * 把单元格序列化为单行字符串：行间用 <br>，cell 内的 \n 也转成 <br>，pipe 字符转义。
 * 不输出 mermaid / mindmap，对应 element 由调用方抽到表格下方。
 */
function serializeCellForGfm(cell) {
  if (!cell) return '';
  if (typeof cell === 'string') {
    return escapeCellInline(cell).replace(/\r?\n/g, '<br>');
  }
  const elements = Array.isArray(cell.elements) ? cell.elements
    : cell.element ? [cell.element]
      : [];
  if (elements.length === 0) return '';
  const lines = mergeCellLinesForGfm(elements);
  if (lines.length === 0) return '';
  return lines
    .map((line) => escapeCellInline(line).replace(/\r?\n/g, '<br>'))
    .join('<br>');
}

/**
 * 收集 cell 内的 mermaid / mindmap 元素，按出现顺序返回。
 */
function collectCellDiagrams(cell) {
  if (!cell || typeof cell === 'string') return [];
  const elements = Array.isArray(cell.elements) ? cell.elements
    : cell.element ? [cell.element]
      : [];
  return elements.filter((el) => el && (el.type === 'mermaid' || el.type === 'mindmap'));
}

function diagramToNativeMd(diagram) {
  if (!diagram) return '';
  if (diagram.type === 'mermaid') {
    return ['```mermaid', (diagram.code || '').replace(/\s+$/, ''), '```'].join('\n');
  }
  if (diagram.type === 'mindmap') {
    return (diagram.code || '').replace(/\s+$/, '');
  }
  return '';
}

function serializeNativeTable(headers, rows) {
  if (!Array.isArray(headers) || headers.length === 0) return { tableMd: '', diagrams: [] };
  const safeHeaders = headers.map((h) => escapeCellInline(String(h ?? '')));
  const headerLine = `|${safeHeaders.join('|')}|`;
  const sepLine = `|${safeHeaders.map(() => '---').join('|')}|`;
  const dataLines = [];
  const diagrams = [];

  rows.forEach((row) => {
    const cells = headers.map((_, ci) => row?.[ci]);
    const renderedCells = cells.map((cell) => serializeCellForGfm(cell));
    dataLines.push(`|${renderedCells.join('|')}|`);
    cells.forEach((cell) => {
      collectCellDiagrams(cell).forEach((d) => diagrams.push(d));
    });
  });

  return {
    tableMd: [headerLine, sepLine, ...dataLines].join('\n'),
    diagrams,
  };
}

function serializeBlockToNativeMd(block) {
  if (!block) return '';
  const { type, content } = block;
  const headingMatch = type.match(/^h([1-7])$/);
  if (headingMatch) {
    const text = content?.markdown || content?.text || '';
    return `${'#'.repeat(Number(headingMatch[1]))} ${text}`;
  }
  switch (type) {
    case 'paragraph': {
      if (content?.type === 'image') return `![](${content.src})`;
      return content?.markdown || '';
    }
    case 'divider':
      return '---';
    case 'mermaid':
      return ['```mermaid', (content?.code || '').replace(/\s+$/, ''), '```'].join('\n');
    case 'mindmap':
      return (content?.code || '').replace(/\s+$/, '');
    case 'table': {
      const headers = content?.headers || [];
      const rows = content?.rows || [];
      const { tableMd, diagrams } = serializeNativeTable(headers, rows);
      const diagramMd = diagrams
        .map(diagramToNativeMd)
        .filter((s) => s)
        .join('\n\n');
      if (!tableMd) return diagramMd;
      if (!diagramMd) return tableMd;
      return `${tableMd}\n\n${diagramMd}`;
    }
    case 'prd-section': {
      const { title, designImage, interactionMarkdown, logicMarkdown } = content || {};
      const parts = [];
      if (title) parts.push(`## ${title}`);
      if (designImage) parts.push(`![${title || ''}设计稿](${designImage})`);
      if (interactionMarkdown) parts.push(interactionMarkdown);
      if (logicMarkdown) parts.push(logicMarkdown);
      return parts.join('\n\n');
    }
    default:
      return '';
  }
}

/**
 * 把 Block[] 序列化为原生 Markdown 字符串。
 * 同时把 `/prd/...` 的图片路径改写成 `./assets/...`，与导出 zip 的目录结构对齐。
 */
export function serializePrdAsNativeMd(blocks) {
  const sections = (blocks || [])
    .map(serializeBlockToNativeMd)
    .filter((s) => s !== '');
  const md = sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
  return rewritePrdAssetPathsForNativeMd(md);
}
