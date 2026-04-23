import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertCircle, FiCode, FiBarChart2 } from 'react-icons/fi';
import { PrdLightbox } from '../PrdLightbox.jsx';
import { AsyncDiagramSurface } from '../AsyncDiagramSurface.jsx';
import { emitPrdToast } from '../../prd-toast.js';
import { DEFAULT_DIAGRAM_VIEW_MODE } from '../../prd-constants.js';
import {
  estimateMermaidTextareaRows,
  getMermaidLib,
} from './mermaid-renderer-utils.js';

let mermaidRenderSeq = 0;

export function MermaidRenderer({
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
  const textareaRef = useRef(null);
  const lineNumbersRef = useRef(null);
  const viewMenuRef = useRef(null);
  const renderTaskRef = useRef(0);

  useEffect(() => { setLocalViewMode(viewMode); }, [viewMode]);

  useEffect(() => {
    if (localViewMode !== 'chart') {
      setRendering(false);
      return;
    }
    const currentCode = (code || '').trim();
    const renderTaskId = ++renderTaskRef.current;
    if (!currentCode) {
      setSvgHtml('');
      setRenderError('Mermaid 代码为空');
      setRendering(false);
      return;
    }
    let cancelled = false;
    const renderKey = `mermaid-${Date.now()}-${++mermaidRenderSeq}`;
    setRendering(true);
    setRenderError('');
    getMermaidLib().then((mermaidLib) => mermaidLib.render(renderKey, currentCode)).then(
      ({ svg }) => {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml(svg);
          setRenderError('');
          setRendering(false);
        }
      },
      (err) => {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml('');
          setRenderError(String(err?.message || err));
          setRendering(false);
        }
      },
    );
    return () => { cancelled = true; };
  }, [code, localViewMode]);

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
    if (target?.closest('.prd-mermaid-renderer__view-btn, .prd-mermaid-renderer__view-menu')) {
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
        'prd-mermaid-renderer',
        isSelected ? 'prd-mermaid-renderer--selected' : '',
      ].filter(Boolean).join(' ')}
      style={rootStyle}
      data-prd-no-block-select
      onMouseDown={handleChartMouseDown}
    >
      <div
        className="prd-mermaid-renderer__toolbar"
        onMouseMove={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className="prd-mermaid-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div
            ref={viewMenuRef}
            className="prd-mermaid-renderer__view-menu"
            onMouseMove={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className={`prd-mermaid-renderer__view-menu-item${localViewMode === 'code' ? ' prd-mermaid-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('code')}
            >
              仅展示代码{localViewMode === 'code' ? ' ✓' : ''}
            </button>
            <button
              type="button"
              className={`prd-mermaid-renderer__view-menu-item${localViewMode === 'chart' ? ' prd-mermaid-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('chart')}
            >
              仅展示图表{localViewMode === 'chart' ? ' ✓' : ''}
            </button>
          </div>
        )}
      </div>

      {localViewMode === 'code' && (
        <div className="prd-mermaid-renderer__code-area" style={codeAreaStyle}>
          <div
            ref={lineNumbersRef}
            className="prd-mermaid-renderer__line-numbers"
            aria-hidden="true"
            onScroll={syncTextareaScroll}
          >
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mermaid-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mermaid-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            onScroll={syncLineNumbersScroll}
            spellCheck={false}
            rows={textareaRows}
          />
        </div>
      )}

      {localViewMode === 'chart' && (
        <div className="prd-mermaid-renderer__chart-area" ref={chartRef}>
          {renderError ? (
            <div className="prd-mermaid-renderer__error">
              <FiAlertCircle size={16} />
              <span>Mermaid 图表无法渲染：{renderError}</span>
            </div>
          ) : (
            <AsyncDiagramSurface
              className="prd-mermaid-renderer__svg-wrap"
              hasContent={Boolean(svgHtml)}
              loading={rendering}
              loadingText="图表加载中…"
              emptyText="暂无图表内容"
              interactive={Boolean(svgHtml)}
            >
              <div
                className="prd-mermaid-renderer__svg-canvas"
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
