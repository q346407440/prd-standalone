import markdownit from 'markdown-it';
import { parseListPrefix } from './prd-list-utils.js';
import {
  resolveMermaidViewMode,
  resolveMermaidWidth,
  resolveMindmapViewMode,
  resolveMindmapWidth,
} from './prd-perf-keys.js';

const MERMAID_BLOCK_DEFAULT_WIDTH = 628;
const MINDMAP_BLOCK_DEFAULT_WIDTH = 628;

const exportMd = markdownit({ html: false, linkify: false, breaks: false });
exportMd.renderer.rules.link_open = (tokens, idx) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  return `<a href="${escapeAttribute(href)}" class="prd-export-link" target="_blank" rel="noreferrer noopener">`;
};

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

export function normalizeAssetUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) return '';
  return trimmed.split('?')[0];
}

export function toPreviewAssetPath(url) {
  const exportPath = toExportAssetPath(url);
  return exportPath ? `./${exportPath}` : '';
}

export function toExportAssetPath(url) {
  const normalized = normalizeAssetUrl(url);
  if (!normalized) return '';
  return `public${normalized}`;
}

function renderMarkdownBodyHtml(markdown) {
  const rendered = exportMd.render(markdown || '').trim();
  return rendered || '<p></p>';
}

function renderRichTextHtml(markdown) {
  const parsed = parseListPrefix(markdown || '');
  const bodyMarkdown = parsed ? (parsed.body ?? '') : (markdown || '');
  const bodyHtml = renderMarkdownBodyHtml(bodyMarkdown);
  if (!parsed) {
    return `
      <div class="prd-editable-md prd-editable-md--preview prd-export-readonly-preview">
        <div class="prd-tiptap-preview-row">
          <span class="prd-tiptap-prosemirror prd-tiptap-prosemirror--readonly">${bodyHtml}</span>
        </div>
      </div>
    `;
  }
  const indentLevel = Math.floor((parsed.indent || '').length / 2);
  const marker = /^[-*+]$/.test(parsed.marker) ? '•' : escapeHtml(parsed.marker);
  return `
    <div class="prd-editable-md prd-editable-md--preview prd-export-readonly-preview">
      <div class="prd-tiptap-preview-row">
        <span class="prd-list-marker" style="padding-left:${indentLevel * 16}px">${marker} </span>
        <span class="prd-tiptap-prosemirror prd-tiptap-prosemirror--readonly">${bodyHtml}</span>
      </div>
    </div>
  `;
}

function normalizeCellElements(cell) {
  if (cell && Array.isArray(cell.elements)) return cell.elements;
  if (cell && cell.element) return [cell.element];
  if (typeof cell === 'string') return [{ type: 'text', markdown: cell }];
  return [{ type: 'text', markdown: '' }];
}

function diagramWidthStyle(widthPx) {
  return widthPx ? ` style="--prd-export-diagram-width:${Math.max(160, Number(widthPx) || 0)}px"` : '';
}

function renderDiagramCodeHtml(code, rendererClass) {
  const lines = String(code || '').split('\n');
  const lineCount = Math.max(lines.length, 1);
  const lineNumbers = Array.from({ length: lineCount }, (_, index) => (
    `<div class="${rendererClass}__line-number">${index + 1}</div>`
  )).join('');
  return `
    <div class="${rendererClass}__code-area">
      <div class="${rendererClass}__line-numbers" aria-hidden="true">${lineNumbers}</div>
      <pre class="${rendererClass}__textarea prd-export-diagram__textarea"><code>${escapeHtml(code || '')}</code></pre>
    </div>
  `;
}

function renderDiagramHtml({
  rendererClass,
  code,
  svgHtml,
  error,
  initialView,
  widthPx,
}) {
  const isCode = initialView !== 'chart';
  return `
    <div class="${rendererClass}"${diagramWidthStyle(widthPx)} data-current-view="${isCode ? 'code' : 'chart'}">
      <div class="${rendererClass}__toolbar prd-export-diagram-toolbar">
        <button
          type="button"
          class="${rendererClass}__view-btn prd-export-diagram-toggle${isCode ? ' is-active' : ''}"
          data-view-btn="code"
        >文本模式</button>
        <button
          type="button"
          class="${rendererClass}__view-btn prd-export-diagram-toggle${isCode ? '' : ' is-active'}"
          data-view-btn="chart"
        >图片模式</button>
      </div>
      <div class="prd-export-diagram__panel${isCode ? ' is-active' : ''}" data-panel="code">
        ${renderDiagramCodeHtml(code, rendererClass)}
      </div>
      <div class="prd-export-diagram__panel${isCode ? '' : ' is-active'}" data-panel="chart">
        ${error
          ? `<div class="${rendererClass}__error">${escapeHtml(error)}</div>`
          : svgHtml
            ? `<div class="${rendererClass}__chart-area"><div class="${rendererClass}__svg-wrap prd-export-zoomable-svg" data-lightbox-kind="svg"><div class="${rendererClass}__svg-canvas">${svgHtml}</div></div></div>`
            : `<div class="${rendererClass}__empty">暂无图表内容</div>`}
      </div>
    </div>
  `;
}

function buildImageHtml(src, widthPx, assetPathMap) {
  if (!src) {
    return '<div class="prd-export-image__error">图片地址为空</div>';
  }
  const previewSrc = assetPathMap.get(normalizeAssetUrl(src)) || toPreviewAssetPath(src);
  if (!previewSrc) {
    return `<div class="prd-export-image__error">图片路径无效：${escapeHtml(src)}</div>`;
  }
  const widthStyle = widthPx ? ` style="--prd-export-media-width:${Math.max(80, Number(widthPx) || 0)}px"` : '';
  return `
    <div class="prd-image-renderer"${widthStyle}>
      <div class="prd-image-renderer__img-wrap">
        <img
          class="prd-image-renderer__img prd-export-zoomable-image"
          src="${escapeAttribute(previewSrc)}"
          alt="PRD 图片"
          draggable="false"
        />
      </div>
    </div>
  `;
}

export async function buildElementHtml(element, context, diagramPlacement = null) {
  if (!element) return '';
  if (element.type === 'image') {
    const widthPx = context.imageMeta?.[element.src] ?? null;
    return buildImageHtml(element.src, widthPx, context.assetPathMap);
  }
  if (element.type === 'mermaid') {
    const placement = diagramPlacement && (diagramPlacement.kind === 'standalone' || diagramPlacement.kind === 'table')
      ? diagramPlacement
      : null;
    const initialView = resolveMermaidViewMode(context.mermaidMeta, element.code, placement);
    const widthPx = resolveMermaidWidth(context.mermaidMeta, element.code, placement, MERMAID_BLOCK_DEFAULT_WIDTH);
    const rendered = await context.renderMermaidSvg(element.code || '');
    return renderDiagramHtml({
      rendererClass: 'prd-mermaid-renderer',
      code: element.code || '',
      svgHtml: rendered?.svgHtml || '',
      error: rendered?.error || '',
      initialView,
      widthPx,
    });
  }
  if (element.type === 'mindmap') {
    const placement = diagramPlacement && (diagramPlacement.kind === 'standalone' || diagramPlacement.kind === 'table')
      ? diagramPlacement
      : null;
    const initialView = resolveMindmapViewMode(context.mindmapMeta, element.code, placement);
    const widthPx = resolveMindmapWidth(context.mindmapMeta, element.code, placement, MINDMAP_BLOCK_DEFAULT_WIDTH);
    const rendered = await context.renderMindmapSvg(element.code || '');
    return renderDiagramHtml({
      rendererClass: 'prd-mindmap-renderer',
      code: element.code || '',
      svgHtml: rendered?.svgHtml || '',
      error: rendered?.error || '',
      initialView,
      widthPx,
    });
  }
  return renderRichTextHtml(element.markdown || '');
}

export async function buildTableHtml(block, context) {
  const headers = block.content?.headers || [];
  const rows = block.content?.rows || [];
  const rowHtmlList = [];
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    const cellHtmlList = [];
    for (let ci = 0; ci < headers.length; ci += 1) {
      const elements = normalizeCellElements(row[ci]);
      const pieces = [];
      for (let elIdx = 0; elIdx < elements.length; elIdx += 1) {
        pieces.push(await buildElementHtml(elements[elIdx], context, {
          kind: 'table',
          blockId: block.id,
          ri,
          ci,
          idx: elIdx,
        }));
      }
      cellHtmlList.push(`
        <td data-label="${escapeAttribute(headers[ci] || '')}">
          <div class="prd-export-table__cell-stack">${pieces.join('')}</div>
        </td>
      `);
    }
    rowHtmlList.push(`<tr>${cellHtmlList.join('')}</tr>`);
  }
  return `
    <section class="prd-export-block prd-block-table">
      <div class="prd-table-wrap prd-block-table__wrap prd-export-table__wrap">
        <table class="prd-table prd-export-table">
          <thead>
            <tr>${headers.map((header) => `<th>${escapeHtml(header)}</th>`).join('')}</tr>
          </thead>
          <tbody>${rowHtmlList.join('')}</tbody>
        </table>
      </div>
    </section>
  `;
}

export async function buildContentHtml(blocks, context) {
  const parts = [];
  for (const block of blocks || []) {
    if (!block) continue;
    if (/^h[1-7]$/.test(block.type || '')) {
      const level = Number(block.type.slice(1));
      const title = (block.content?.markdown || block.content?.text || '').trim() || '未命名标题';
      const headingHtml = exportMd.renderInline(title || '').trim() || escapeHtml(title);
      parts.push(`
        <section class="prd-export-block prd-export-block--heading">
          <div
            id="${escapeAttribute(block.id)}"
            data-heading-anchor="${escapeAttribute(block.id)}"
            class="prd-block-heading prd-block-heading--h${level} prd-export-heading-anchor"
          >
            <div class="prd-tiptap-prosemirror prd-tiptap-prosemirror--readonly">${headingHtml}</div>
          </div>
        </section>
      `);
      continue;
    }
    if (block.type === 'paragraph') {
      parts.push(`
        <section class="prd-export-block prd-export-block--paragraph">
          ${await buildElementHtml(block.content, context)}
        </section>
      `);
      continue;
    }
    if (block.type === 'divider') {
      parts.push('<hr class="prd-export-divider" />');
      continue;
    }
    if (block.type === 'mermaid' || block.type === 'mindmap') {
      parts.push(`
        <section class="prd-export-block prd-export-block--diagram">
          ${await buildElementHtml(block.content, context, { kind: 'standalone', blockId: block.id })}
        </section>
      `);
      continue;
    }
    if (block.type === 'table') {
      parts.push(await buildTableHtml(block, context));
    }
  }
  return parts.join('');
}

export function buildTocItems(blocks) {
  return (blocks || [])
    .filter((block) => /^h[1-7]$/.test(block?.type || ''))
    .map((block) => ({
      id: block.id,
      level: Number(block.type.slice(1)),
      title: (block.content?.markdown || block.content?.text || '').trim() || '未命名标题',
    }));
}

export function buildTocTree(items) {
  const root = [];
  const stack = [{ level: 0, children: root }];
  items.forEach((item) => {
    const node = { ...item, children: [] };
    while (stack.length > 1 && item.level <= stack[stack.length - 1].level) {
      stack.pop();
    }
    stack[stack.length - 1].children.push(node);
    stack.push(node);
  });
  return root;
}

export function renderTreeNodes(nodes) {
  if (!nodes.length) {
    return '<div class="prd-page__toc-empty">暂无目录</div>';
  }
  return nodes.map((node) => {
    const hasChildren = node.children.length > 0;
    return `
      <div class="prd-export-tree__node prd-export-tree__node--level-${node.level}">
        <div class="prd-export-tree__row">
          ${hasChildren
            ? `<button type="button" class="prd-export-tree__toggle" data-tree-toggle aria-expanded="true" title="折叠子章节">▾</button>`
            : '<span class="prd-export-tree__toggle prd-export-tree__toggle--placeholder"></span>'}
          <button
            type="button"
            class="prd-page__toc-item prd-page__toc-item--level-${node.level} prd-export-tree__link"
            data-target-id="${escapeAttribute(node.id)}"
            title="${escapeAttribute(node.title)}"
          ><span class="prd-page__toc-item-text">${escapeHtml(node.title)}</span></button>
        </div>
        ${hasChildren ? `<div class="prd-export-tree__children">${renderTreeNodes(node.children)}</div>` : ''}
      </div>
    `;
  }).join('');
}

export function collectPrdAssetUrls(...sources) {
  const set = new Set();
  const re = /\/prd\/[^\s)"'`]+?\.(?:png|jpe?g|gif|webp|svg)/gi;
  sources.forEach((source) => {
    const text = typeof source === 'string' ? source : JSON.stringify(source ?? null);
    if (!text) return;
    let match;
    while ((match = re.exec(text)) !== null) {
      const normalized = normalizeAssetUrl(match[0]);
      if (normalized) set.add(normalized);
    }
  });
  return [...set];
}

export function extractDocTitle(blocks, fallbackTitle) {
  const h1 = (blocks || []).find((block) => block?.type === 'h1');
  const fromBlock = h1?.content?.markdown || h1?.content?.text || '';
  return fromBlock.trim() || String(fallbackTitle || 'PRD 离线预览').trim() || 'PRD 离线预览';
}
