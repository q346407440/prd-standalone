/**
 * prd-writer.js
 * 把 Block[] 序列化回 prd.md。
 * 標題（h1–h7）與 paragraph 為**原生 Markdown**，無 `<!-- block:... -->`；
 * 結構化塊（table / mermaid / mindmap / divider / prd-section 等）仍帶 block 標記（島塊含 end）。
 *
 * Block.content 為 Element：
 *   { type: 'text', markdown, tightJoinPrev?: boolean } — 后者为真时与上一 **text** paragraph 序列化时用 `\n` 拼接（无空行顶层列表拆块）。
 *   { type: 'image', src, alt? }
 *   { type: 'divider' }
 *   { type: 'table', headers, rows: CellElement[][] }
 *   { type: 'mermaid', code }
 *   { type: 'mindmap', code }
 *
 * CellElement：{ element: TextElement | ImageElement | MermaidElement | MindmapElement }
 */

import { serializeMarkdownImage } from './prd-image-markdown.js';
import { isIslandBlockType } from './prd-island-block-markers.js';

// ─── Element → 字串（GFM 舊格式，供離線匯出和飛書使用）──────────────────────

function serializeOneElementGfm(element) {
  if (!element) return '';
  if (element.type === 'image') return serializeMarkdownImage(element.src, element.alt);
  if (element.type === 'mermaid') return `:::mermaid:::${element.code || ''}:::end-mermaid:::`;
  if (element.type === 'mindmap') return `:::mindmap:::${element.code || ''}:::end-mindmap:::`;
  return element.markdown || '';
}

function serializeCellElementGfm(cell) {
  if (!cell) return '';
  if (Array.isArray(cell.elements)) {
    const parts = cell.elements.map(serializeOneElementGfm).filter((s) => s !== '');
    return parts.join('<br>');
  }
  if (cell.element) return serializeOneElementGfm(cell.element);
  return '';
}

// ─── GFM 表格序列化（保留供離線匯出和飛書使用）──────────────────────────────

export function serializeGfmTable(headers, rows) {
  if (!headers.length) return '';

  const stringRows = rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === 'string') return cell;
      return serializeCellElementGfm(cell);
    })
  );

  const cellText = (v) => (v == null ? '' : String(v));
  const headerLine = '| ' + headers.map(cellText).join(' | ') + ' |';
  const sepLine = '| ' + headers.map(() => '---').join(' | ') + ' |';
  const dataLines = stringRows.map(
    (row) => '| ' + headers.map((_, i) => cellText(row[i])).join(' | ') + ' |'
  );

  return [headerLine, sepLine, ...dataLines].join('\n');
}

// ─── Cell 標記格式序列化（v2 新格式）────────────────────────────────────────

function serializeCellFormatTable(headers, rows) {
  if (!headers.length) return '';
  const parts = [];

  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    for (let ci = 0; ci < headers.length; ci += 1) {
      const colName = headers[ci];
      parts.push(`<!-- cell:r${ri + 1}:${colName} -->`);
      const cellContent = serializeCellContent(row[ci]);
      if (cellContent) {
        parts.push(cellContent);
      }
    }
  }

  return parts.join('\n');
}

const LIST_LINE_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)\s/;

function isListLine(text) {
  return LIST_LINE_RE.test(text);
}

/**
 * 先把 splitMarkdownByInlineImages 拆散的碎片（text prefix + image + text suffix）
 * 合併回邏輯行，再按行類型決定分隔符。
 *
 * 識別碎片的規則：
 * - image 前面緊跟的 text 末尾不含換行 → 它們原本是同一行
 * - image 後面緊跟的 text 不以列表前綴開頭 → 它們原本是同一行的後綴
 */
export function serializeCellContent(cell) {
  if (!cell) return '';
  const elements = Array.isArray(cell.elements) ? cell.elements
    : cell.element ? [cell.element]
      : [];

  if (elements.length === 0) return '';
  if (elements.length === 1 && elements[0].type === 'text' && !elements[0].markdown) return '';

  const lines = mergeInlineImageFragments(elements);
  if (lines.length === 0) return '';

  const out = [lines[0].text];
  for (let i = 1; i < lines.length; i++) {
    const prev = lines[i - 1];
    const curr = lines[i];
    const bothList = prev.kind === 'list' && curr.kind === 'list';
    out.push(bothList ? '\n' : '\n\n');
    out.push(curr.text);
  }

  return out.join('');
}

/**
 * 與 mergeInlineImageFragments 同源：每段帶 parts，便於計算各 element 在序列化格內的字元偏移。
 * @returns {{ kind: 'block'|'text'|'list', parts: { idx: number, str: string }[] }[]}
 */
function mergeInlineImageFragmentParts(elements) {
  const merged = [];
  let i = 0;

  while (i < elements.length) {
    const el = elements[i];
    if (!el) { i++; continue; }

    if (el.type === 'mermaid') {
      merged.push({
        kind: 'block',
        parts: [{ idx: i, str: `\`\`\`mermaid\n${el.code || ''}\n\`\`\`` }],
      });
      i++;
      continue;
    }
    if (el.type === 'mindmap') {
      merged.push({
        kind: 'block',
        parts: [{ idx: i, str: el.code || '' }],
      });
      i++;
      continue;
    }

    if (el.type === 'image') {
      const parts = [{ idx: i, str: serializeMarkdownImage(el.src, el.alt) }];
      i++;
      while (i < elements.length && elements[i]?.type === 'text' && isInlineSuffix(elements[i].markdown)) {
        parts.push({ idx: i, str: elements[i].markdown });
        i++;
      }
      merged.push({ kind: 'text', parts });
      continue;
    }

    const md = el.markdown || '';
    if (!md) { i++; continue; }

    const parts = [{ idx: i, str: md }];
    i++;
    while (i < elements.length && elements[i]?.type === 'image') {
      parts.push({ idx: i, str: serializeMarkdownImage(elements[i].src, elements[i].alt) });
      i++;
      while (i < elements.length && elements[i]?.type === 'text' && isInlineSuffix(elements[i].markdown)) {
        parts.push({ idx: i, str: elements[i].markdown });
        i++;
      }
    }

    const line = parts.map((p) => p.str).join('');
    merged.push({ kind: isListLine(line) ? 'list' : 'text', parts });
  }

  return merged;
}

/**
 * 把 splitMarkdownByInlineImages 拆散的碎片重組回邏輯行。
 * 只合併「原本是同一行的行內圖文混排」碎片，不合併 <br> 分段的獨立段落。
 */
function mergeInlineImageFragments(elements) {
  return mergeInlineImageFragmentParts(elements).map((seg) => ({
    kind: seg.kind,
    text: seg.parts.map((p) => p.str).join(''),
  }));
}

/**
 * 表格儲存格序列化後字串中，每個 element 索引對應的起始字元偏移（與 serializeCellContent 一致）。
 * @param {object} cell
 * @returns {number[]}
 */
export function getCellElementCharStartsInSerializedCell(cell) {
  const elements = Array.isArray(cell?.elements) ? cell.elements
    : cell?.element ? [cell.element]
      : [];

  const n = elements.length;
  if (n === 0) return [];
  if (n === 1 && elements[0].type === 'text' && !elements[0].markdown) return [0];

  const starts = new Array(n).fill(-1);
  const merged = mergeInlineImageFragmentParts(elements);
  let full = '';

  for (let si = 0; si < merged.length; si += 1) {
    if (si > 0) {
      const prev = merged[si - 1];
      const curr = merged[si];
      const bothList = prev.kind === 'list' && curr.kind === 'list';
      full += bothList ? '\n' : '\n\n';
    }
    const seg = merged[si];
    const line = seg.parts.map((p) => p.str).join('');
    let off = 0;
    for (const p of seg.parts) {
      starts[p.idx] = full.length + off;
      off += p.str.length;
    }
    full += line;
  }

  for (let j = 0; j < n; j += 1) {
    if (starts[j] < 0) starts[j] = full.length;
  }
  return starts;
}

function isInlineSuffix(text) {
  if (!text) return false;
  return !LIST_LINE_RE.test(text) && !text.startsWith('**') && !text.startsWith('![');
}

// ─── 單個 Block 序列化 ───────────────────────────────────────────────────────

function serializeBlock(block) {
  const { type, content } = block;
  const headingMatch = type.match(/^h([1-7])$/);

  if (headingMatch) {
    return `${'#'.repeat(Number(headingMatch[1]))} ${content.markdown || content.text || ''}`;
  }

  switch (type) {
    case 'paragraph': {
      if (content.type === 'image') {
        return serializeMarkdownImage(content.src, content.alt);
      }
      return content.markdown || '';
    }

    case 'divider':
      return `<!-- block:${type} -->\n---`;

    case 'mermaid': {
      const parts = [`<!-- block:${type} -->`];
      parts.push('```mermaid');
      parts.push(content.code || '');
      parts.push('```');
      parts.push('<!-- /block:mermaid -->');
      return parts.join('\n');
    }

    case 'mindmap':
      return `<!-- block:${type} -->\n${content.code || ''}\n<!-- /block:mindmap -->`;

    case 'table': {
      const headers = content.headers || [];
      const colsAttr = headers.join(',');
      const marker = `<!-- block:table cols="${colsAttr}" -->`;
      const tableText = serializeCellFormatTable(headers, content.rows || []);
      return `${marker}\n${tableText}\n<!-- /block:table -->`;
    }

    case 'prd-section': {
      const { title, designImage, interactionMarkdown, logicMarkdown } = content;
      const parts = [`<!-- block:${type} -->`];
      parts.push(`## ${title}`);
      parts.push('');
      parts.push('<!-- section:design -->');
      if (designImage) parts.push(`![${title}设计稿](${designImage})`);
      parts.push('');
      parts.push('<!-- section:interaction -->');
      if (interactionMarkdown) parts.push(interactionMarkdown);
      parts.push('');
      parts.push('<!-- section:logic -->');
      if (logicMarkdown) parts.push(logicMarkdown);
      parts.push('');
      parts.push('<!-- section:end -->');
      return parts.join('\n');
    }

    default:
      return '';
  }
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 相邻块之间的拼接：连续「列表项」paragraph（后者带 `content.tightJoinPrev`）用单换行，其余用空行。
 * @param {object[]} blocks
 * @param {number} indexNext 当前块下标（≥1）
 * @returns {'\n'|'\n\n'}
 */
export function glueBetweenPrdBlocks(blocks, indexNext) {
  const list = blocks || [];
  if (indexNext <= 0 || indexNext >= list.length) return '\n\n';
  const b = list[indexNext];
  const prev = list[indexNext - 1];
  const useTight = b?.type === 'paragraph'
    && b?.content?.type === 'text'
    && b.content.tightJoinPrev
    && prev?.type === 'paragraph'
    && prev?.content?.type === 'text';
  return useTight ? '\n' : '\n\n';
}

/** 首块不应带 tightJoinPrev；上一块非正文段时无效。 */
export function stripInvalidTightJoinFlags(blocks) {
  return (blocks || []).map((b, i) => {
    if (b.type !== 'paragraph' || b.content?.type !== 'text' || !b.content.tightJoinPrev) return b;
    if (i === 0) {
      const { tightJoinPrev, ...rest } = b.content;
      return { ...b, content: rest };
    }
    const prev = blocks[i - 1];
    const ok = prev?.type === 'paragraph' && prev?.content?.type === 'text';
    if (!ok) {
      const { tightJoinPrev, ...rest } = b.content;
      return { ...b, content: rest };
    }
    return b;
  });
}

/**
 * 与 serializePrd 一致：全文一次 `\\n{3,}`→`\\n\\n` 再 trimEnd + `\\n`。
 */
function finalizePrdSerializedBody(raw) {
  return raw.replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

/**
 * raw 前缀 [0, rawIndexExclusive) 经与全文同规则折叠后，在折叠串中的长度（0..collapsed.length）。
 * 前缀若截断在某段连续 \\n 中间：未凑满三连的部分按字面计入；凑满三连则按折叠为 2 个 \\n。
 * 这样与先拼全文再 replace(/\\n{3,}/g,'\\n\\n') 在任意截断点一致。
 */
export function collapsedPrefixLengthAtRawIndex(fullRaw, rawIndexExclusive) {
  if (rawIndexExclusive <= 0) return 0;
  const cap = Math.min(rawIndexExclusive, fullRaw.length);
  let r = 0;
  let outLen = 0;
  while (r < cap) {
    const ch = fullRaw[r];
    if (ch !== '\n') {
      r += 1;
      outLen += 1;
      continue;
    }
    const runStart = r;
    let j = r;
    while (j < fullRaw.length && fullRaw[j] === '\n') j += 1;
    const runLen = j - runStart;
    const prefixEnd = Math.min(j, cap);
    const inPrefix = prefixEnd - runStart;
    if (inPrefix < runLen) {
      outLen += inPrefix >= 3 ? 2 : inPrefix;
      r = prefixEnd;
      continue;
    }
    outLen += runLen >= 3 ? 2 : runLen;
    r = j;
  }
  return outLen;
}

/**
 * 与 serializePrd 输出一致，返回每个 block 对应内容在全文中的 1-based 行区间（与磁盘 .md 对齐；亦可供调试与旧版行号逻辑）。
 */
export function getBlockContentLineRanges1Based(blocks) {
  const list = stripInvalidTightJoinFlags(blocks || []);
  if (!list.length) return [];
  const parts = list.map(serializeBlock);
  let raw = '';
  const rawStarts = [];
  for (let i = 0; i < list.length; i += 1) {
    if (i > 0) raw += glueBetweenPrdBlocks(list, i);
    rawStarts.push(raw.length);
    raw += parts[i];
  }
  const collapsed = raw.replace(/\n{3,}/g, '\n\n');
  const fullMd = finalizePrdSerializedBody(raw);

  /** 折叠串中的 exclusive 字符偏移 → 与磁盘 fullMd 一致的 1-based 行号 */
  const lineAtSerializedOffset = (collapsedOff) => {
    const o = Math.max(0, Math.min(collapsedOff, collapsed.length));
    const trimmedLen = collapsed.trimEnd().length;
    const clamped = Math.min(o, trimmedLen);
    return fullMd.slice(0, clamped).split('\n').length;
  };

  const ranges = [];
  for (let i = 0; i < list.length; i += 1) {
    const startOff = collapsedPrefixLengthAtRawIndex(raw, rawStarts[i]);
    const endRawEx = rawStarts[i] + (parts[i]?.length ?? 0);
    const endOff = collapsedPrefixLengthAtRawIndex(raw, endRawEx);
    ranges.push({
      contentStartLine: lineAtSerializedOffset(startOff),
      contentEndLine: lineAtSerializedOffset(endOff),
    });
  }
  return ranges;
}

/**
 * 把 Block[] 序列化成 prd.md 文字（新格式 v2，cell 標記）。
 * @param {Block[]} blocks
 * @returns {string}
 */
export function serializePrd(blocks) {
  const list = stripInvalidTightJoinFlags(blocks || []);
  if (!list.length) return '\n';
  const parts = list.map(serializeBlock);
  let out = parts[0];
  for (let i = 1; i < list.length; i += 1) {
    out += glueBetweenPrdBlocks(list, i) + parts[i];
  }
  return finalizePrdSerializedBody(out);
}

/**
 * 把 Block[] 序列化成 GFM 格式（供離線匯出等需要 GFM 表格的場景）。
 * @param {Block[]} blocks
 * @returns {string}
 */
export function serializePrdAsGfm(blocks) {
  const list = stripInvalidTightJoinFlags(blocks || []);
  if (!list.length) return '\n';
  const parts = list.map(serializeBlockAsGfm);
  let out = parts[0];
  for (let i = 1; i < list.length; i += 1) {
    out += glueBetweenPrdBlocks(list, i) + parts[i];
  }
  return finalizePrdSerializedBody(out);
}

function serializeBlockAsGfm(block) {
  const { type, content } = block;
  const headingMatch = type.match(/^h([1-7])$/);

  if (headingMatch) {
    return `${'#'.repeat(Number(headingMatch[1]))} ${content.markdown || content.text || ''}`;
  }

  switch (type) {
    case 'paragraph': {
      if (content.type === 'image') {
        return serializeMarkdownImage(content.src, content.alt);
      }
      return content.markdown || '';
    }
    case 'divider': {
      const parts = [`<!-- block:${type} -->`];
      parts.push('---');
      const body = parts.join('\n');
      return body;
    }
    case 'mermaid': {
      const parts = [`<!-- block:${type} -->`];
      parts.push('```mermaid');
      parts.push(content.code || '');
      parts.push('```');
      const body = parts.join('\n');
      return `${body}\n<!-- /block:mermaid -->`;
    }
    case 'mindmap': {
      const body = [`<!-- block:${type} -->`, content.code || '', '<!-- /block:mindmap -->'].join('\n');
      return body;
    }
    case 'table': {
      const parts = [`<!-- block:${type} -->`];
      const tableText = serializeGfmTable(content.headers || [], content.rows || []);
      parts.push(tableText);
      const body = parts.join('\n');
      return `${body}\n<!-- /block:table -->`;
    }
    case 'prd-section': {
      const parts = [`<!-- block:${type} -->`];
      const { title, designImage, interactionMarkdown, logicMarkdown } = content;
      parts.push(`## ${title}`);
      parts.push('');
      parts.push('<!-- section:design -->');
      if (designImage) parts.push(`![${title}设计稿](${designImage})`);
      parts.push('');
      parts.push('<!-- section:interaction -->');
      if (interactionMarkdown) parts.push(interactionMarkdown);
      parts.push('');
      parts.push('<!-- section:logic -->');
      if (logicMarkdown) parts.push(logicMarkdown);
      parts.push('');
      parts.push('<!-- section:end -->');
      return parts.join('\n');
    }
    default:
      return '';
  }
}

/**
 * 更新指定 sectionId 的 designImage 路徑（局部回寫）。
 */
export function updateBlockDesignImage(blocks, sectionId, imagePath) {
  return blocks.map((b) => {
    if (b.type === 'prd-section' && b.content.sectionId === sectionId) {
      return { ...b, content: { ...b.content, designImage: imagePath } };
    }
    return b;
  });
}
