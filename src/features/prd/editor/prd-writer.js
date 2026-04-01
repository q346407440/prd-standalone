/**
 * prd-writer.js
 * 把 Block[] 序列化回 prd.md 新格式（v2）。
 * 每個 Block 前加 <!-- block:type --> 標記。
 *
 * Block.content 為 Element：
 *   { type: 'text', markdown }
 *   { type: 'image', src }
 *   { type: 'divider' }
 *   { type: 'table', headers, rows: CellElement[][] }
 *   { type: 'mermaid', code }
 *   { type: 'mindmap', code }
 *
 * CellElement：{ element: TextElement | ImageElement | MermaidElement | MindmapElement }
 */

// ─── Element → 字串 ──────────────────────────────────────────────────────────

function serializeOneElement(element) {
  if (!element) return '';
  if (element.type === 'image') return `![](${element.src})`;
  if (element.type === 'mermaid') return `:::mermaid:::${element.code || ''}:::end-mermaid:::`;
  if (element.type === 'mindmap') return `:::mindmap:::${element.code || ''}:::end-mindmap:::`;
  return element.markdown || '';
}

function serializeCellElement(cell) {
  if (!cell) return '';
  // 新格式：{ elements: Element[] }
  if (Array.isArray(cell.elements)) {
    const parts = cell.elements.map(serializeOneElement).filter((s) => s !== '');
    return parts.join('<br>');
  }
  // 向下相容舊格式：{ element: Element }
  if (cell.element) return serializeOneElement(cell.element);
  return '';
}

// ─── GFM 表格序列化 ──────────────────────────────────────────────────────────

function serializeGfmTable(headers, rows) {
  if (!headers.length) return '';

  // rows 可能是 CellElement[][] 或舊的 string[][]（向下相容）
  const stringRows = rows.map((row) =>
    row.map((cell) => {
      if (typeof cell === 'string') return cell;
      return serializeCellElement(cell);
    })
  );

  const colWidths = headers.map((h, i) => {
    const maxData = stringRows.reduce((max, row) => Math.max(max, (row[i] || '').length), 0);
    return Math.max(h.length, maxData, 3);
  });

  const pad = (str, width) => (str || '').padEnd(width);
  const headerLine = '| ' + headers.map((h, i) => pad(h, colWidths[i])).join(' | ') + ' |';
  const sepLine = '| ' + colWidths.map((w) => '-'.repeat(w)).join(' | ') + ' |';
  const dataLines = stringRows.map(
    (row) => '| ' + headers.map((_, i) => pad(row[i] || '', colWidths[i])).join(' | ') + ' |'
  );

  return [headerLine, sepLine, ...dataLines].join('\n');
}

// ─── 單個 Block 序列化 ───────────────────────────────────────────────────────

function serializeBlock(block) {
  const { type, content } = block;
  const parts = [`<!-- block:${type} -->`];
  const headingMatch = type.match(/^h([1-7])$/);

  if (headingMatch) {
    parts.push(`${'#'.repeat(Number(headingMatch[1]))} ${content.markdown || content.text || ''}`);
    return parts.join('\n');
  }

  switch (type) {
    case 'paragraph': {
      if (content.type === 'image') {
        parts.push(`![](${content.src})`);
      } else {
        parts.push(content.markdown || '');
      }
      break;
    }

    case 'divider':
      parts.push('---');
      break;

    case 'mermaid': {
      parts.push('```mermaid');
      parts.push(content.code || '');
      parts.push('```');
      break;
    }

    case 'mindmap': {
      parts.push(content.code || '');
      break;
    }

    case 'table': {
      const tableText = serializeGfmTable(content.headers || [], content.rows || []);
      parts.push(tableText);
      break;
    }

    case 'prd-section': {
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
      break;
    }

    default:
      break;
  }

  return parts.join('\n');
}

// ─── 主入口 ──────────────────────────────────────────────────────────────────

/**
 * 把 Block[] 序列化成 prd.md 文字（新格式 v2）。
 * @param {Block[]} blocks
 * @returns {string}
 */
export function serializePrd(blocks) {
  const sections = blocks.map(serializeBlock);
  return sections.join('\n\n').replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
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
