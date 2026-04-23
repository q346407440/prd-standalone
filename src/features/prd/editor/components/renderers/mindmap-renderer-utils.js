import {
  convertMermaidMindmapToMarkdown,
  waitForNextAnimationFrame,
} from './mermaid-renderer-utils.js';

let markmapDepsPromise = null;
let markmapTransformer = null;

export async function getMarkmapDeps() {
  if (!markmapDepsPromise) {
    markmapDepsPromise = Promise.all([
      import('markmap-lib'),
      import('markmap-view'),
    ]).then(([libMod, viewMod]) => ({
      Transformer: libMod.Transformer,
      Markmap: viewMod.Markmap,
    }));
  }
  const deps = await markmapDepsPromise;
  if (!markmapTransformer) markmapTransformer = new deps.Transformer();
  return {
    ...deps,
    transformer: markmapTransformer,
  };
}

export async function renderMindmapSvgForExport(code) {
  let currentCode = (code || '').trim();
  const converted = convertMermaidMindmapToMarkdown(currentCode);
  if (converted !== null) currentCode = converted;
  if (!currentCode) {
    return { svgHtml: '', error: '思维导图代码为空' };
  }

  let host = null;
  let markmap = null;
  try {
    const { transformer, Markmap } = await getMarkmapDeps();
    const { root } = transformer.transform(currentCode);

    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1200px;visibility:hidden;pointer-events:none;overflow:hidden;';
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svgEl);
    document.body.appendChild(host);

    const mmOptions = { autoFit: true, pan: false, zoom: false, duration: 0 };
    markmap = Markmap.create(svgEl, mmOptions, root);
    await waitForNextAnimationFrame();
    await waitForNextAnimationFrame();

    const g = svgEl.querySelector('g');
    const clone = svgEl.cloneNode(true);
    if (g) {
      const bbox = g.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        const pad = 30;
        clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
        const cloneG = clone.querySelector('g');
        if (cloneG) cloneG.setAttribute('transform', '');
      }
    }
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.cssText = 'width:100%;height:auto;min-height:0';
    return { svgHtml: clone.outerHTML, error: '' };
  } catch (error) {
    return { svgHtml: '', error: String(error?.message || error) };
  } finally {
    try { markmap?.destroy?.(); } catch { /* noop */ }
    host?.remove();
  }
}
