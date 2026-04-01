import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertCircle, FiCode, FiBarChart2 } from 'react-icons/fi';
import { PrdLightbox } from '../PrdLightbox.jsx';
import { AsyncDiagramSurface } from '../AsyncDiagramSurface.jsx';
import { convertMermaidMindmapToMarkdown, waitForNextAnimationFrame } from './MermaidRenderer.jsx';

let _markmapDepsPromise = null;
let _markmapTransformer = null;

export async function getMarkmapDeps() {
  if (!_markmapDepsPromise) {
    _markmapDepsPromise = Promise.all([
      import('markmap-lib'),
      import('markmap-view'),
    ]).then(([libMod, viewMod]) => ({
      Transformer: libMod.Transformer,
      Markmap: viewMod.Markmap,
    }));
  }
  const deps = await _markmapDepsPromise;
  if (!_markmapTransformer) _markmapTransformer = new deps.Transformer();
  return {
    ...deps,
    transformer: _markmapTransformer,
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
    try { markmap?.destroy?.(); } catch (_) { /* noop */ }
    host?.remove();
  }
}

export function MindmapRenderer({
  code,
  onCodeChange,
  viewMode = 'code',
  onViewModeChange,
  widthPx = null,
  onWidthChange,
  resizable = false,
}) {
  const [localViewMode, setLocalViewMode] = useState(viewMode);
  const [svgHtml, setSvgHtml] = useState('');
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [localWidthPx, setLocalWidthPx] = useState(widthPx);
  const [lightbox, setLightbox] = useState(false);
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const dragRef = useRef(null);
  const textareaRef = useRef(null);
  const viewMenuRef = useRef(null);
  const renderTaskRef = useRef(0);

  useEffect(() => { setLocalViewMode(viewMode); }, [viewMode]);
  useEffect(() => { setLocalWidthPx(widthPx); }, [widthPx]);

  useEffect(() => {
    if (localViewMode !== 'chart') {
      setRendering(false);
      return;
    }
    let currentCode = (code || '').trim();
    const renderTaskId = ++renderTaskRef.current;

    const converted = convertMermaidMindmapToMarkdown(currentCode);
    if (converted !== null) {
      setRendering(false);
      onCodeChange?.(converted);
      return;
    }

    if (!currentCode) {
      setSvgHtml('');
      setRenderError('思维导图代码为空');
      setRendering(false);
      if (markmapRef.current) {
        try { markmapRef.current.destroy?.(); } catch (_) { /* noop */ }
        markmapRef.current = null;
      }
      return;
    }
    let cancelled = false;
    setRendering(true);
    setRenderError('');
    getMarkmapDeps().then(({ transformer, Markmap }) => {
      if (cancelled || renderTaskRef.current !== renderTaskId) return;
      try {
        const { root } = transformer.transform(currentCode);
        const svgEl = svgRef.current;
        if (!svgEl) throw new Error('思维导图挂载节点未就绪');
        const mmOptions = { autoFit: true, pan: false, zoom: false, duration: 0 };
        if (markmapRef.current) {
          markmapRef.current.setOptions(mmOptions);
          markmapRef.current.setData(root);
          markmapRef.current.fit();
        } else {
          markmapRef.current = Markmap.create(svgEl, mmOptions, root);
        }
        requestAnimationFrame(() => {
          if (cancelled || renderTaskRef.current !== renderTaskId || !svgEl) return;
          const g = svgEl.querySelector('g');
          const clone = svgEl.cloneNode(true);
          if (g) {
            const bbox = g.getBBox();
            const pad = 30;
            clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
            const cloneG = clone.querySelector('g');
            if (cloneG) cloneG.setAttribute('transform', '');
          }
          clone.removeAttribute('width');
          clone.removeAttribute('height');
          clone.style.cssText = 'width:100%;height:auto;min-height:0';
          setSvgHtml(clone.outerHTML);
          setRenderError('');
          setRendering(false);
        });
      } catch (err) {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml('');
          setRenderError(String(err?.message || err));
          setRendering(false);
        }
      }
    }).catch((err) => {
      if (!cancelled && renderTaskRef.current === renderTaskId) {
        setSvgHtml('');
        setRenderError(String(err?.message || err));
        setRendering(false);
      }
    });
    return () => { cancelled = true; };
  }, [code, localViewMode, onCodeChange]);

  useEffect(() => {
    return () => {
      if (markmapRef.current) {
        try { markmapRef.current.destroy?.(); } catch (_) { /* noop */ }
        markmapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showViewMenu) return;
    const handleClickOutside = (e) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) {
        setShowViewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [showViewMenu]);

  const handleViewModeSwitch = useCallback((mode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
    setShowViewMenu(false);
  }, [onViewModeChange]);

  const handleResizeMouseDown = useCallback((e, corner) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const rootEl = rootRef.current;
    if (!rootEl) return;
    const startW = rootEl.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startW, corner };

    const onMove = (ev) => {
      const { startX, startW: sw, corner: c } = dragRef.current;
      const dx = ev.clientX - startX;
      const delta = (c === 'nw' || c === 'sw') ? -dx : dx;
      const nextW = Math.max(160, Math.round(sw + delta));
      dragRef.current._lastW = nextW;
      setLocalWidthPx(nextW);
    };
    const onUp = () => {
      const finalW = dragRef.current?._lastW;
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (finalW != null) onWidthChange?.(finalW);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [resizable, onWidthChange]);

  const lines = (code || '').split('\n');
  const lineCount = Math.max(lines.length, 1);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const rootStyle = resizable && localWidthPx != null ? { width: localWidthPx } : {};

  return (
    <div
      ref={rootRef}
      className="prd-mindmap-renderer"
      style={rootStyle}
      data-prd-no-block-select
    >
      <div className="prd-mindmap-renderer__toolbar">
        <button
          type="button"
          className="prd-mindmap-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div ref={viewMenuRef} className="prd-mindmap-renderer__view-menu">
            <button
              type="button"
              className={`prd-mindmap-renderer__view-menu-item${localViewMode === 'code' ? ' prd-mindmap-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('code')}
            >
              仅展示代码{localViewMode === 'code' ? ' ✓' : ''}
            </button>
            <button
              type="button"
              className={`prd-mindmap-renderer__view-menu-item${localViewMode === 'chart' ? ' prd-mindmap-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('chart')}
            >
              仅展示图表{localViewMode === 'chart' ? ' ✓' : ''}
            </button>
          </div>
        )}
      </div>

      {localViewMode === 'code' && (
        <div className="prd-mindmap-renderer__code-area">
          <div className="prd-mindmap-renderer__line-numbers" aria-hidden="true">
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mindmap-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mindmap-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            spellCheck={false}
            rows={lineCount}
          />
        </div>
      )}

      {localViewMode === 'chart' && (
        <div className="prd-mindmap-renderer__chart-area" ref={chartRef}>
          {renderError ? (
            <div className="prd-mindmap-renderer__error">
              <FiAlertCircle size={16} />
              <span>思维导图无法渲染：{renderError}</span>
            </div>
          ) : (
            <AsyncDiagramSurface
              className="prd-mindmap-renderer__svg-wrap"
              hasContent={Boolean(svgHtml)}
              loading={rendering}
              loadingText="思维导图加载中…"
              emptyText="暂无思维导图内容"
              interactive={Boolean(svgHtml)}
              onClick={() => setLightbox(true)}
            >
              <svg
                ref={svgRef}
                style={{
                  width: '100%',
                  minHeight: 200,
                  visibility: svgHtml || rendering ? 'visible' : 'hidden',
                }}
              />
            </AsyncDiagramSurface>
          )}
        </div>
      )}

      {resizable && ['nw', 'ne', 'sw', 'se'].map((corner) => (
        <div
          key={corner}
          className={`prd-mindmap-renderer__handle prd-mindmap-renderer__handle--${corner}`}
          onMouseDown={(e) => handleResizeMouseDown(e, corner)}
        />
      ))}

      {lightbox && svgHtml && createPortal(
        <PrdLightbox htmlContent={svgHtml} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </div>
  );
}
