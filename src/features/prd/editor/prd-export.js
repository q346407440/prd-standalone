import JSZip from 'jszip';
import markdownit from 'markdown-it';
import { parseListPrefix } from './prd-list-utils.js';
import { serializePrd } from './prd-writer.js';
import prdCssRaw from './styles/prd.css?raw';
import prdEditableCssRaw from './styles/prd-editable.css?raw';
import prdTableEditCssRaw from './styles/prd-table-edit.css?raw';
import prdBlocksCssRaw from './styles/prd-blocks.css?raw';
import prdRenderersCssRaw from './styles/prd-renderers.css?raw';
import prdModalsCssRaw from './styles/prd-modals.css?raw';
import prdPageLayoutCssRaw from './styles/prd-page-layout.css?raw';
import prdTableCssRaw from '../../../shared/styles/prd-table.css?raw';
import prdSectionCssRaw from '../../../shared/styles/prd-section.css?raw';

const exportMd = markdownit({ html: false, linkify: false, breaks: false });
exportMd.renderer.rules.link_open = (tokens, idx) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  return `<a href="${escapeAttribute(href)}" class="prd-export-link" target="_blank" rel="noreferrer noopener">`;
};

const MERMAID_BLOCK_DEFAULT_WIDTH = 628;
const MINDMAP_BLOCK_DEFAULT_WIDTH = 628;
const PROJECT_EXPORT_CSS = [
  prdTableCssRaw,
  prdSectionCssRaw,
  prdCssRaw,
  prdEditableCssRaw,
  prdTableEditCssRaw,
  prdBlocksCssRaw,
  prdRenderersCssRaw,
  prdModalsCssRaw,
  prdPageLayoutCssRaw,
].join('\n');

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, '&#96;');
}

function toSafeAsciiBaseName(name, fallback = 'prd-export') {
  const ascii = String(name || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return ascii || fallback;
}

function toPreviewHtmlFileName(name, fallback) {
  return `${toSafeAsciiBaseName(name, fallback)}-preview.html`;
}

function toZipFileName(name, fallback) {
  return `${toSafeAsciiBaseName(name, fallback)}.zip`;
}

function normalizeAssetUrl(url) {
  if (typeof url !== 'string') return '';
  const trimmed = url.trim();
  if (!trimmed.startsWith('/')) return '';
  return trimmed.split('?')[0];
}

function escapeJsonForInlineScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function getMdFileNameFromPath(mdPath, fallbackTitle) {
  const parts = String(mdPath || '').split('/');
  const fileName = parts[parts.length - 1] || '';
  if (fileName.endsWith('.md')) {
    return `${toSafeAsciiBaseName(getBaseName(fileName), fallbackTitle || 'prd-doc')}.md`;
  }
  return `${toSafeAsciiBaseName(fallbackTitle || 'prd-doc', 'prd-doc')}.md`;
}

function getBaseName(fileName) {
  return String(fileName || 'prd.md').replace(/\.md$/i, '');
}

function buildMetaPayload({ imageMeta, mermaidMeta, mindmapMeta }) {
  return {
    ...(imageMeta || {}),
    ...(mermaidMeta || {}),
    ...(mindmapMeta || {}),
  };
}

function collectPrdAssetUrls(...sources) {
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

function toExportAssetPath(url) {
  const normalized = normalizeAssetUrl(url);
  if (!normalized) return '';
  return `public${normalized}`;
}

function toPreviewAssetPath(url) {
  const exportPath = toExportAssetPath(url);
  return exportPath ? `./${exportPath}` : '';
}

async function fetchAssetBlob(url, cache) {
  const normalized = normalizeAssetUrl(url);
  if (!normalized) {
    throw new Error(`非法资源路径：${url}`);
  }
  const cached = cache.get(normalized);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(normalized, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`资源读取失败：${normalized}`);
    }
    return res.blob();
  })();
  cache.set(normalized, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(normalized);
    throw error;
  }
}

function mermaidCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0;
  }
  return `mermaid_${h.toString(36)}`;
}

function mindmapCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h >>>= 0;
  }
  return `mindmap_${h.toString(36)}`;
}

function extractDocTitle(blocks, fallbackTitle) {
  const h1 = (blocks || []).find((block) => block?.type === 'h1');
  const fromBlock = h1?.content?.markdown || h1?.content?.text || '';
  return fromBlock.trim() || String(fallbackTitle || 'PRD 离线预览').trim() || 'PRD 离线预览';
}

function buildTocItems(blocks) {
  return (blocks || [])
    .filter((block) => /^h[1-7]$/.test(block?.type || ''))
    .map((block) => ({
      id: block.id,
      level: Number(block.type.slice(1)),
      title: (block.content?.markdown || block.content?.text || '').trim() || '未命名标题',
    }));
}

function buildTocTree(items) {
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

function renderTreeNodes(nodes) {
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

async function buildElementHtml(element, context) {
  if (!element) return '';
  if (element.type === 'image') {
    const widthPx = context.imageMeta?.[element.src] ?? null;
    return buildImageHtml(element.src, widthPx, context.assetPathMap);
  }
  if (element.type === 'mermaid') {
    const metaKey = mermaidCodeToMetaKey(element.code || '');
    const initialView = context.mermaidMeta?.mermaidViewModes?.[metaKey] || 'code';
    const widthPx = context.mermaidMeta?.mermaidWidths?.[metaKey] ?? MERMAID_BLOCK_DEFAULT_WIDTH;
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
    const metaKey = mindmapCodeToMetaKey(element.code || '');
    const initialView = context.mindmapMeta?.mindmapViewModes?.[metaKey] || 'code';
    const widthPx = context.mindmapMeta?.mindmapWidths?.[metaKey] ?? MINDMAP_BLOCK_DEFAULT_WIDTH;
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

async function buildTableHtml(block, context) {
  const headers = block.content?.headers || [];
  const rows = block.content?.rows || [];
  const rowHtmlList = [];
  for (let ri = 0; ri < rows.length; ri += 1) {
    const row = rows[ri] || [];
    const cellHtmlList = [];
    for (let ci = 0; ci < headers.length; ci += 1) {
      const elements = normalizeCellElements(row[ci]);
      const pieces = [];
      for (const element of elements) {
        pieces.push(await buildElementHtml(element, context));
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

async function buildContentHtml(blocks, context) {
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
          ${await buildElementHtml(block.content, context)}
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

function buildStandaloneHtml({ title }) {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(title)}</title>
  <style>
    ${PROJECT_EXPORT_CSS}
    html, body {
      height: 100%;
      margin: 0;
      overflow: hidden;
      background: #f6f8fb;
    }
    .prd-export-page {
      height: 100%;
      min-height: 0;
      overflow: hidden;
    }
    .prd-export-page .prd-page__layout {
      height: 100%;
      min-height: 0;
    }
    .prd-export-page .prd-page__toc-pane {
      flex-basis: clamp(220px, 24vw, 320px);
      width: clamp(220px, 24vw, 320px);
      opacity: 1;
      pointer-events: auto;
      border-right-color: #dbe4ef;
      overflow: visible;
    }
    .prd-export-page.is-sidebar-collapsed .prd-page__toc-pane {
      flex-basis: 0;
      width: 0;
      opacity: 0;
      pointer-events: none;
      border-right-color: transparent;
      overflow: hidden;
    }
    .prd-export-page .prd-page__toc-shell {
      opacity: 1;
      transform: none;
    }
    .prd-export-page .prd-page__content-scroll {
      background: #fff;
    }
    .prd-export-page .prd-page__main {
      padding-top: 28px;
      padding-bottom: 48px;
    }
    .prd-export-page__meta {
      padding: 0 14px 10px;
      font-size: 12px;
      color: #8c97a8;
      border-bottom: 1px solid #e7edf5;
      background: #f8fafc;
    }
    .prd-export-page__fab {
      position: fixed;
      top: 16px;
      left: 16px;
      z-index: 40;
      display: none;
    }
    .prd-export-page.is-sidebar-collapsed .prd-export-page__fab {
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .prd-export-tree__node {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .prd-export-tree__row {
      display: flex;
      align-items: center;
      gap: 0;
      min-width: 0;
    }
    .prd-export-tree__children {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 0;
    }
    .prd-export-tree__toggle {
      all: unset;
      width: 18px;
      min-width: 18px;
      height: 18px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      color: #7b8794;
      cursor: pointer;
      border-radius: 6px;
      flex: 0 0 18px;
      margin-right: 4px;
    }
    .prd-export-tree__toggle--placeholder {
      cursor: default;
      visibility: hidden;
    }
    .prd-export-tree__node.is-collapsed > .prd-export-tree__children {
      display: none;
    }
    .prd-export-tree__node.is-collapsed > .prd-export-tree__row .prd-export-tree__toggle {
      transform: rotate(-90deg);
    }
    .prd-export-page .prd-page__toc-item {
      min-width: 100%;
    }
    .prd-export-page .prd-page__toc-item:hover {
      background: transparent;
      color: inherit;
    }
    .prd-export-page .prd-page__toc-toggle:hover,
    .prd-export-page .prd-mermaid-renderer__view-btn:hover,
    .prd-export-page .prd-mindmap-renderer__view-btn:hover {
      background: inherit;
      color: inherit;
      border-color: inherit;
      box-shadow: none;
    }
    .prd-export-readonly-preview,
    .prd-export-readonly-preview:hover,
    .prd-export-readonly-preview.prd-editable-md--preview-selected {
      cursor: default;
      background: transparent;
      border-color: transparent;
      border-style: solid;
      padding: 0;
      min-height: auto;
    }
    .prd-export-readonly-preview .prd-tiptap-prosemirror {
      width: 100%;
    }
    .prd-export-heading-anchor {
      scroll-margin-top: 24px;
    }
    .prd-export-block {
      margin-bottom: 16px;
    }
    .prd-export-table__wrap {
      overflow: auto !important;
    }
    .prd-export-table__cell-stack {
      display: flex;
      flex-direction: column;
      gap: 12px;
      min-width: 0;
    }
    .prd-export-page .prd-image-renderer {
      width: min(100%, var(--prd-export-media-width, 100%));
      cursor: default;
    }
    .prd-export-page .prd-image-renderer__img {
      cursor: zoom-in;
    }
    .prd-export-page .prd-mermaid-renderer,
    .prd-export-page .prd-mindmap-renderer {
      width: min(100%, var(--prd-export-diagram-width, 100%));
    }
    .prd-export-page pre.prd-mermaid-renderer__textarea,
    .prd-export-page pre.prd-mindmap-renderer__textarea {
      margin: 0;
      white-space: pre-wrap;
      word-break: break-word;
      overflow: auto;
      cursor: default;
    }
    .prd-export-diagram-toolbar {
      display: flex;
      gap: 8px;
    }
    .prd-export-diagram-toggle.is-active {
      border-color: #b8d4ff;
      background: #eef4fd;
      color: #1677ff;
    }
    .prd-export-diagram__panel {
      display: none;
    }
    .prd-export-diagram__panel.is-active {
      display: block;
    }
    .prd-export-diagram__textarea {
      border-radius: 0;
    }
    .prd-export-image__error {
      padding: 12px 16px;
      font-size: 12px;
      color: #e53e3e;
      background: #fff5f5;
      border-radius: 4px;
    }
    .prd-export-lightbox[hidden] { display: none; }
    .prd-export-lightbox {
      position: fixed;
      inset: 0;
      z-index: 9999;
      background: rgba(15, 23, 42, 0.76);
      display: flex;
      flex-direction: column;
      padding: 18px;
    }
    .prd-export-lightbox__toolbar {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
      margin-bottom: 12px;
    }
    .prd-export-lightbox__btn {
      appearance: none;
      border: 1px solid rgba(255, 255, 255, 0.24);
      background: rgba(255, 255, 255, 0.12);
      color: #fff;
      border-radius: 999px;
      padding: 8px 12px;
      cursor: pointer;
      font-size: 13px;
      line-height: 1;
    }
    .prd-export-lightbox__viewport {
      flex: 1;
      min-height: 0;
      overflow: auto;
      display: flex;
      justify-content: center;
      align-items: flex-start;
      padding: 20px 0 36px;
    }
    .prd-export-lightbox__stage {
      transform-origin: top center;
      transition: transform 0.12s ease;
      display: inline-block;
      max-width: min(1400px, calc(100vw - 96px));
    }
    .prd-export-lightbox__stage img,
    .prd-export-lightbox__stage svg {
      display: block;
      max-width: 100%;
      height: auto;
      background: #fff;
      border-radius: 14px;
      box-shadow: 0 18px 48px rgba(15, 23, 42, 0.32);
    }
    @media (max-width: 960px) {
      .prd-export-page.is-sidebar-collapsed .prd-page__toc-pane {
        transform: translateX(-100%);
        width: clamp(220px, 24vw, 320px);
        flex-basis: clamp(220px, 24vw, 320px);
        opacity: 1;
        border-right-color: #dbe4ef;
      }
      .prd-export-page .prd-page__main {
        width: calc(100% - 28px);
        padding-top: 72px;
      }
    }
  </style>
</head>
<body>
  <div class="prd-page prd-export-page" data-prd-export-app>
    <button type="button" class="prd-page__toc-toggle prd-export-page__fab" data-sidebar-toggle aria-label="展开目录">☰</button>
    <div class="prd-page__layout">
      <aside class="prd-page__toc-pane prd-page__toc-pane--open">
        <div class="prd-page__toc-shell">
          <div class="prd-page__toc-header">
            <button type="button" class="prd-page__toc-toggle prd-page__toc-toggle--inline" data-sidebar-toggle aria-label="收起目录">≪</button>
            <span class="prd-page__toc-title">目录</span>
          </div>
          <div class="prd-export-page__meta" data-exported-at></div>
          <div class="prd-page__toc-scroll" data-preview-tree></div>
        </div>
      </aside>
      <div class="prd-page__content-pane">
        <div class="prd-page__content-scroll" data-content-scroll>
          <main class="prd-page__main" data-preview-content></main>
        </div>
      </div>
    </div>
  </div>
  <div class="prd-export-lightbox" data-lightbox hidden>
    <div class="prd-export-lightbox__toolbar">
      <button type="button" class="prd-export-lightbox__btn" data-lightbox-action="zoom-out">缩小</button>
      <button type="button" class="prd-export-lightbox__btn" data-lightbox-action="zoom-in">放大</button>
      <button type="button" class="prd-export-lightbox__btn" data-lightbox-action="reset">重置</button>
      <button type="button" class="prd-export-lightbox__btn" data-lightbox-action="close">关闭</button>
    </div>
    <div class="prd-export-lightbox__viewport" data-lightbox-close>
      <div class="prd-export-lightbox__stage" data-lightbox-stage></div>
    </div>
  </div>
  <script src="./preview-data.js"></script>
  <script>
    (() => {
      const exportData = window.__PRD_EXPORT_DATA__ || {};
      const app = document.querySelector('[data-prd-export-app]');
      const treeContainer = document.querySelector('[data-preview-tree]');
      const contentContainer = document.querySelector('[data-preview-content]');
      const contentScroll = document.querySelector('[data-content-scroll]');
      const exportedAtNode = document.querySelector('[data-exported-at]');
      if (treeContainer) {
        treeContainer.innerHTML = '<div class="prd-page__toc-tree">'
          + (exportData.treeHtml || '<div class="prd-page__toc-empty">暂无目录</div>')
          + '</div>';
      }
      if (contentContainer) contentContainer.innerHTML = exportData.contentHtml || '';
      if (exportedAtNode) exportedAtNode.textContent = exportData.exportedAtLabel ? '导出时间：' + exportData.exportedAtLabel : '';

      const sidebarToggleButtons = document.querySelectorAll('[data-sidebar-toggle]');
      const headingButtons = Array.from(document.querySelectorAll('[data-target-id]'));
      const headingNodes = headingButtons.map((button) => {
        const id = button.getAttribute('data-target-id');
        return {
          id,
          button,
          node: id ? document.getElementById(id) : null,
        };
      }).filter((item) => item.node);

      function setSidebarCollapsed(collapsed) {
        app.classList.toggle('is-sidebar-collapsed', collapsed);
      }

      sidebarToggleButtons.forEach((button) => {
        button.addEventListener('click', () => {
          setSidebarCollapsed(!app.classList.contains('is-sidebar-collapsed'));
        });
      });

      function expandTreeAncestors(button) {
        let node = button.closest('.prd-export-tree__node');
        while (node) {
          node.classList.remove('is-collapsed');
          const toggle = node.querySelector(':scope > .prd-export-tree__row [data-tree-toggle]');
          if (toggle) toggle.setAttribute('aria-expanded', 'true');
          node = node.parentElement?.closest('.prd-export-tree__node') || null;
        }
      }

      document.querySelectorAll('[data-tree-toggle]').forEach((toggle) => {
        toggle.addEventListener('click', (event) => {
          event.stopPropagation();
          const node = toggle.closest('.prd-export-tree__node');
          if (!node) return;
          const nextCollapsed = !node.classList.contains('is-collapsed');
          node.classList.toggle('is-collapsed', nextCollapsed);
          toggle.setAttribute('aria-expanded', String(!nextCollapsed));
        });
      });

      function setActiveHeading(activeId) {
        headingButtons.forEach((button) => {
          button.classList.toggle('prd-page__toc-item--active', button.getAttribute('data-target-id') === activeId);
        });
        const activeButton = headingButtons.find((button) => button.classList.contains('prd-page__toc-item--active'));
        if (activeButton) {
          expandTreeAncestors(activeButton);
          activeButton.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
      }

      function updateActiveHeadingByScroll() {
        if (!contentScroll || !headingNodes.length) return;
        const activationLine = contentScroll.scrollTop + Math.min(Math.max(contentScroll.clientHeight * 0.22, 96), 180);
        let activeId = headingNodes[0].id;
        headingNodes.forEach((item) => {
          if (item.node.offsetTop <= activationLine) activeId = item.id;
        });
        setActiveHeading(activeId);
      }

      let scrollFrame = null;
      if (contentScroll) {
        contentScroll.addEventListener('scroll', () => {
          if (scrollFrame != null) return;
          scrollFrame = requestAnimationFrame(() => {
            scrollFrame = null;
            updateActiveHeadingByScroll();
          });
        }, { passive: true });
      }

      headingButtons.forEach((button) => {
        button.addEventListener('click', () => {
          const targetId = button.getAttribute('data-target-id');
          const targetNode = targetId ? document.getElementById(targetId) : null;
          if (!targetNode) return;
          expandTreeAncestors(button);
          setActiveHeading(targetId);
          targetNode.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
          if (window.innerWidth <= 960) setSidebarCollapsed(true);
        });
      });
      updateActiveHeadingByScroll();

      document.querySelectorAll('.prd-mermaid-renderer, .prd-mindmap-renderer').forEach((diagram) => {
        const buttons = Array.from(diagram.querySelectorAll('[data-view-btn]'));
        const panels = Array.from(diagram.querySelectorAll('[data-panel]'));
        const applyView = (view) => {
          diagram.setAttribute('data-current-view', view);
          buttons.forEach((button) => {
            button.classList.toggle('is-active', button.getAttribute('data-view-btn') === view);
          });
          panels.forEach((panel) => {
            panel.classList.toggle('is-active', panel.getAttribute('data-panel') === view);
          });
        };
        buttons.forEach((button) => {
          button.addEventListener('click', () => applyView(button.getAttribute('data-view-btn')));
        });
        applyView(diagram.getAttribute('data-current-view') || 'code');
      });

      const lightbox = document.querySelector('[data-lightbox]');
      const lightboxStage = document.querySelector('[data-lightbox-stage]');
      const lightboxViewport = document.querySelector('.prd-export-lightbox__viewport');
      let lightboxScale = 1;

      function applyLightboxScale() {
        if (!lightboxStage) return;
        lightboxStage.style.transform = 'scale(' + lightboxScale + ')';
      }

      function openLightboxHtml(html) {
        if (!lightbox || !lightboxStage || !html) return;
        lightboxStage.innerHTML = html;
        lightboxScale = 1;
        applyLightboxScale();
        lightbox.hidden = false;
      }

      function closeLightbox() {
        if (!lightbox || !lightboxStage) return;
        lightbox.hidden = true;
        lightboxStage.innerHTML = '';
        if (lightboxViewport) lightboxViewport.scrollTo({ top: 0, left: 0 });
      }

      document.querySelectorAll('.prd-export-zoomable-image').forEach((img) => {
        img.addEventListener('click', () => openLightboxHtml(img.outerHTML));
      });
      document.querySelectorAll('.prd-export-zoomable-svg').forEach((svgWrap) => {
        svgWrap.addEventListener('click', () => openLightboxHtml(svgWrap.innerHTML));
      });

      document.querySelectorAll('[data-lightbox-action]').forEach((button) => {
        button.addEventListener('click', () => {
          const action = button.getAttribute('data-lightbox-action');
          if (action === 'close') closeLightbox();
          if (action === 'zoom-in') {
            lightboxScale = Math.min(5, +(lightboxScale + 0.2).toFixed(2));
            applyLightboxScale();
          }
          if (action === 'zoom-out') {
            lightboxScale = Math.max(0.4, +(lightboxScale - 0.2).toFixed(2));
            applyLightboxScale();
          }
          if (action === 'reset') {
            lightboxScale = 1;
            applyLightboxScale();
          }
        });
      });

      lightbox?.addEventListener('click', (event) => {
        if (event.target?.hasAttribute('data-lightbox-close')) closeLightbox();
      });

      document.addEventListener('keydown', (event) => {
        if (!lightbox || lightbox.hidden) return;
        if (event.key === 'Escape') closeLightbox();
      });
    })();
  </script>
</body>
</html>`;
}

export async function buildStandalonePrdExport({
  title,
  archiveName,
  blocks,
  activeSlug,
  mdPath,
  imageMeta,
  mermaidMeta,
  mindmapMeta,
  annotationsDoc,
  renderMermaidSvg,
  renderMindmapSvg,
}) {
  const docTitle = extractDocTitle(blocks, title);
  const exportSlug = activeSlug || 'doc-001';
  const exportBaseName = toSafeAsciiBaseName(docTitle, `prd-${exportSlug}`);
  const mdFileName = getMdFileNameFromPath(mdPath, exportBaseName);
  const docBaseName = getBaseName(mdFileName);
  const metaPayload = buildMetaPayload({ imageMeta, mermaidMeta, mindmapMeta });
  const mdText = serializePrd(blocks || []);
  const annotationsPayload = annotationsDoc || {};
  const assetUrls = collectPrdAssetUrls(mdText, metaPayload, annotationsPayload, blocks);
  const assetPathMap = new Map(assetUrls.map((url) => [url, toPreviewAssetPath(url)]));
  const tocItems = buildTocItems(blocks);
  const tocTree = buildTocTree(tocItems);
  const contentHtml = await buildContentHtml(blocks, {
    imageMeta,
    mermaidMeta,
    mindmapMeta,
    renderMermaidSvg,
    renderMindmapSvg,
    assetPathMap,
  });
  const treeHtml = renderTreeNodes(tocTree);
  const previewFileName = toPreviewHtmlFileName(docTitle, exportBaseName);
  const previewDataFileName = 'preview-data.js';
  const exportedAtLabel = new Date().toLocaleString('zh-CN');
  const archiveFileName = toZipFileName(archiveName || docTitle, exportBaseName);
  const zip = new JSZip();
  const assetBlobCache = new Map();
  zip.file(previewFileName, buildStandaloneHtml({ title: docTitle }));
  zip.file(previewDataFileName, `window.__PRD_EXPORT_DATA__ = ${escapeJsonForInlineScript({
    title: docTitle,
    activeSlug: exportSlug,
    mdPath: `pages/${exportSlug}/${mdFileName}`,
    mdText,
    meta: metaPayload,
    annotations: annotationsPayload,
    treeHtml,
    contentHtml,
    assetBase: './public/prd/',
    preview: previewFileName,
    exportedAtLabel,
  })};\n`);
  zip.file('README.txt', [
    '本文件仅说明导出包内的文件关系，不约束具体使用方式。',
    '',
    '当前导出文档关系：',
    `- pages/.active-doc.json：当前激活文档指针；其中 slug=${exportSlug}`,
    `- pages/${exportSlug}/${mdFileName}：PRD 正文，是该文档的主内容文件`,
    `- pages/${exportSlug}/${docBaseName}.meta.json：展示元数据；用于记录图片宽度、Mermaid 视图模式/宽度、Mindmap 视图模式/宽度，不承载需求语义`,
    `- pages/${exportSlug}/${docBaseName}.meta.json 常见顶层字段：图片路径 -> width 映射、mermaidViewModes、mermaidWidths、mindmapViewModes、mindmapWidths`,
    `- pages/${exportSlug}/${docBaseName}.annotations.json：标注与增强输入；不是正文唯一真相，但与该文档同前缀关联`,
    `- pages/${exportSlug}/${docBaseName}.annotations.json 常见顶层字段：version、settings、assets，以及与标注/单元格状态相关的增强数据`,
    `- 上述 .md / .meta.json / .annotations.json 三个文件前缀一致，表示它们属于同一份 PRD 文档`,
    '',
    '预览与索引关系：',
    `- ${previewFileName}：离线预览入口`,
    '- preview-data.js：预览页使用的数据快照，包含本次导出的 md / meta / annotations / 渲染结果',
    '- export-manifest.json：导出包索引，声明 preview、source 与 assets 的路径映射关系',
    '',
    '素材关系：',
    '- public/prd/：本次导出中被当前文档数据实际引用到的图片素材集合',
    '- 这里导出的不是整个仓库素材目录，而是当前文档相关的素材子集',
  ].join('\n'));
  zip.file('pages/.active-doc.json', `${escapeJsonForInlineScript({ slug: exportSlug })}\n`);
  zip.file(`pages/${exportSlug}/${mdFileName}`, mdText);
  zip.file(`pages/${exportSlug}/${docBaseName}.meta.json`, `${JSON.stringify(metaPayload, null, 2)}\n`);
  zip.file(`pages/${exportSlug}/${docBaseName}.annotations.json`, `${JSON.stringify(annotationsPayload, null, 2)}\n`);
  zip.file('export-manifest.json', `${JSON.stringify({
    type: 'prd-offline-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: docTitle,
    activeSlug: exportSlug,
    preview: previewFileName,
    previewData: previewDataFileName,
    source: {
      md: `pages/${exportSlug}/${mdFileName}`,
      meta: `pages/${exportSlug}/${docBaseName}.meta.json`,
      annotations: `pages/${exportSlug}/${docBaseName}.annotations.json`,
    },
    assets: assetUrls.map((url) => ({
      source: url,
      exported: toExportAssetPath(url),
    })),
  }, null, 2)}\n`);
  for (const assetUrl of assetUrls) {
    const exportPath = toExportAssetPath(assetUrl);
    if (!exportPath) continue;
    const blob = await fetchAssetBlob(assetUrl, assetBlobCache);
    zip.file(exportPath, blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: archiveFileName,
    title: docTitle,
    previewFileName,
    blob,
  };
}

async function writeBlobToFileHandle(fileHandle, blob) {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function saveStandalonePrdExportToDirectory({ fileName, blob }) {
  if (window.showSaveFilePicker) {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      startIn: 'downloads',
      types: [
        {
          description: 'ZIP 压缩包',
          accept: { 'application/zip': ['.zip'] },
        },
      ],
    });
    await writeBlobToFileHandle(fileHandle, blob);
    return { fileName };
  }
  throw new Error('当前浏览器不支持保存 ZIP 文件');
}

export function downloadStandalonePrdExport({ fileName, blob }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
