import prdCssRaw from './styles/prd.css?raw';
import prdEditableCssRaw from './styles/prd-editable.css?raw';
import prdTableEditCssRaw from './styles/prd-table-edit.css?raw';
import prdBlocksCssRaw from './styles/prd-blocks.css?raw';
import prdRenderersCssRaw from './styles/prd-renderers.css?raw';
import prdModalsCssRaw from './styles/prd-modals.css?raw';
import prdPageLayoutCssRaw from './styles/prd-page-layout.css?raw';
import prdTableCssRaw from '../../../shared/styles/prd-table.css?raw';
import prdSectionCssRaw from '../../../shared/styles/prd-section.css?raw';
import { DEFAULT_DIAGRAM_VIEW_MODE } from './prd-constants.js';
import { escapeHtml } from './prd-export-html-builders.js';

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

export function buildStandaloneHtml({ title }) {
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
        applyView(diagram.getAttribute('data-current-view') || DEFAULT_DIAGRAM_VIEW_MODE);
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
