import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertCircle, FiCode, FiBarChart2 } from 'react-icons/fi';
import { PrdLightbox } from '../PrdLightbox.jsx';
import { AsyncDiagramSurface } from '../AsyncDiagramSurface.jsx';
import { emitPrdToast } from '../../prd-toast.js';
import { DEFAULT_DIAGRAM_VIEW_MODE } from '../../prd-constants.js';
import {
  convertMermaidMindmapToMarkdown,
  estimateMermaidTextareaRows,
} from './mermaid-renderer-utils.js';
import { getMarkmapDeps } from './mindmap-renderer-utils.js';

export function MindmapRenderer({
  code,
  onCodeChange,
  viewMode = DEFAULT_DIAGRAM_VIEW_MODE,
  onViewModeChange,
  widthPx = null,
  isSelected = false,
  onSelect,
}) {
  const [localViewMode, setLocalViewMode] = useState(viewMode);
  const [svgHtml, setSvgHtml] = useState('');
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [chartHeightPx, setChartHeightPx] = useState(null);
  const [lightbox, setLightbox] = useState(false);
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const textareaRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const viewMenuRef = useRef(null);
  const renderTaskRef = useRef(0);

  const destroyMarkmap = useCallback(() => {
    if (!markmapRef.current) return;
    try { markmapRef.current.destroy?.(); } catch { /* noop */ }
    markmapRef.current = null;
  }, []);

  useEffect(() => { setLocalViewMode(viewMode); }, [viewMode]);

  useEffect(() => {
    if (localViewMode !== 'chart') {
      setRendering(false);
      destroyMarkmap();
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
      destroyMarkmap();
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
  }, [code, localViewMode, onCodeChange, destroyMarkmap]);

  useEffect(() => {
    return () => {
      destroyMarkmap();
    };
  }, [destroyMarkmap]);

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

  useEffect(() => {
    if (localViewMode !== 'chart') return undefined;
    const node = chartRef.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => {
      const next = Math.max(60, Math.round(node.getBoundingClientRect().height));
      setChartHeightPx((prev) => (prev === next ? prev : next));
    };
    measure();
    const observer = new ResizeObserver(() => {
      measure();
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, [localViewMode, renderError, rendering, svgHtml]);

  const handleViewModeSwitch = useCallback((mode) => {
    setShowViewMenu(false);
    if (mode === localViewMode) return;
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
    emitPrdToast(
      mode === 'code'
        ? '已保存视图偏好：仅展示代码'
        : '已保存视图偏好：仅展示图表',
    );
  }, [onViewModeChange, localViewMode]);

  const lines = (code || '').split('\n');
  const gutterLineCount = Math.max(lines.length, 1);
  const textareaRows = Math.max(gutterLineCount, estimateMermaidTextareaRows(code));
  const lineNumbers = Array.from({ length: gutterLineCount }, (_, i) => i + 1);

  const syncLineNumbersScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ln = lineNumbersRef.current;
    if (!ta || !ln) return;
    ln.scrollTop = ta.scrollTop;
  }, []);

  const syncTextareaScroll = useCallback(() => {
    const ta = textareaRef.current;
    const ln = lineNumbersRef.current;
    if (!ta || !ln) return;
    ta.scrollTop = ln.scrollTop;
  }, []);

  useEffect(() => {
    if (localViewMode !== 'code') return;
    const id = requestAnimationFrame(() => {
      syncLineNumbersScroll();
    });
    return () => cancelAnimationFrame(id);
  }, [code, localViewMode, gutterLineCount, syncLineNumbersScroll]);

  const handleChartMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    const target = e.target instanceof Element ? e.target : null;
    if (target?.closest('.prd-mindmap-renderer__view-btn, .prd-mindmap-renderer__view-menu')) {
      return;
    }
    if (localViewMode !== 'chart') return;
    if (!svgHtml) {
      return;
    }
    e.preventDefault();
    if (!isSelected) {
      onSelect?.();
      return;
    }
    e.stopPropagation();
    setLightbox(true);
  }, [isSelected, localViewMode, onSelect, svgHtml]);
  const rootStyle = widthPx != null ? { width: `${widthPx}px`, maxWidth: '100%' } : undefined;
  const codeAreaStyle = chartHeightPx != null
    ? { minHeight: `${chartHeightPx}px`, height: `${chartHeightPx}px`, maxHeight: `${chartHeightPx}px` }
    : undefined;

  return (
    <div
      ref={rootRef}
      className={[
        'prd-mindmap-renderer',
        isSelected ? 'prd-mindmap-renderer--selected' : '',
      ].filter(Boolean).join(' ')}
      style={rootStyle}
      data-prd-no-block-select
      onMouseDown={handleChartMouseDown}
    >
      <div
        className="prd-mindmap-renderer__toolbar"
        onMouseMove={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="prd-mindmap-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div
            ref={viewMenuRef}
            className="prd-mindmap-renderer__view-menu"
            onMouseMove={(e) => e.stopPropagation()}
          >
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
        <div className="prd-mindmap-renderer__code-area" style={codeAreaStyle}>
          <div
            ref={lineNumbersRef}
            className="prd-mindmap-renderer__line-numbers"
            aria-hidden="true"
            onScroll={syncTextareaScroll}
          >
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mindmap-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mindmap-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            onScroll={syncLineNumbersScroll}
            spellCheck={false}
            rows={textareaRows}
          />
        </div>
      )}

      {localViewMode === 'chart' && (
        <div
          className="prd-mindmap-renderer__chart-area"
          ref={chartRef}
        >
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
            >
              <div className="prd-mindmap-renderer__svg-hidden" aria-hidden="true">
                <svg
                  ref={svgRef}
                  style={{
                    width: '100%',
                    minHeight: 200,
                    pointerEvents: 'none',
                    visibility: 'hidden',
                  }}
                />
              </div>
              <div
                className="prd-mindmap-renderer__svg-canvas"
                aria-hidden={!svgHtml}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </AsyncDiagramSurface>
          )}
        </div>
      )}

      {lightbox && svgHtml && createPortal(
        <PrdLightbox htmlContent={svgHtml} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </div>
  );
}
