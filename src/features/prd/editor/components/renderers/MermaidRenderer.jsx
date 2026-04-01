import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { FiAlertCircle, FiCode, FiBarChart2 } from 'react-icons/fi';
import { PrdLightbox } from '../PrdLightbox.jsx';
import { AsyncDiagramSurface } from '../AsyncDiagramSurface.jsx';

let _mermaidInitialized = false;
let _mermaidLibPromise = null;
export async function getMermaidLib() {
  if (!_mermaidLibPromise) {
    _mermaidLibPromise = import('mermaid').then((mod) => mod.default || mod);
  }
  const mermaidLib = await _mermaidLibPromise;
  if (_mermaidInitialized) return mermaidLib;
  _mermaidInitialized = true;
  mermaidLib.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  return mermaidLib;
}

export let _mermaidRenderSeq = 0;

/**
 * 检测是否为 Mermaid mindmap 语法并转换为 Markdown 缩进列表。
 */
export function convertMermaidMindmapToMarkdown(code) {
  const MERMAID_MINDMAP_RE = /^mindmap\s*\n/;
  if (!MERMAID_MINDMAP_RE.test(code)) return null;
  const lines = code.split('\n').slice(1);
  if (!lines.length) return '';

  const SHAPE_RE = /^(.*?)(?:\(\(([^)]*)\)\)|\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})(.*)$/;

  let rootIndent = -1;
  const result = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const spaces = rawLine.match(/^(\s*)/)[1].length;
    let text = rawLine.trim();

    if (rootIndent < 0) {
      rootIndent = spaces;
    }

    const shapeMatch = text.match(SHAPE_RE);
    if (shapeMatch) {
      text = (shapeMatch[1] + (shapeMatch[2] ?? shapeMatch[3] ?? shapeMatch[4] ?? shapeMatch[5] ?? '') + shapeMatch[6]).trim();
    }

    const depth = Math.max(0, spaces - rootIndent);
    const indent = '  '.repeat(depth);
    result.push(`${indent}- ${text}`);
  }

  return result.join('\n');
}

export function waitForNextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export async function renderMermaidSvgForExport(code) {
  const currentCode = (code || '').trim();
  if (!currentCode) {
    return { svgHtml: '', error: 'Mermaid 代码为空' };
  }
  try {
    const mermaidLib = await getMermaidLib();
    const renderKey = `mermaid-export-${Date.now()}-${++_mermaidRenderSeq}`;
    const { svg } = await mermaidLib.render(renderKey, currentCode);
    return { svgHtml: svg, error: '' };
  } catch (error) {
    return { svgHtml: '', error: String(error?.message || error) };
  }
}

export function MermaidRenderer({
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
    const currentCode = (code || '').trim();
    const renderTaskId = ++renderTaskRef.current;
    if (!currentCode) {
      setSvgHtml('');
      setRenderError('Mermaid 代码为空');
      setRendering(false);
      return;
    }
    let cancelled = false;
    const renderKey = `mermaid-${Date.now()}-${++_mermaidRenderSeq}`;
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
      className="prd-mermaid-renderer"
      style={rootStyle}
      data-prd-no-block-select
    >
      <div className="prd-mermaid-renderer__toolbar">
        <button
          type="button"
          className="prd-mermaid-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div ref={viewMenuRef} className="prd-mermaid-renderer__view-menu">
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
        <div className="prd-mermaid-renderer__code-area">
          <div className="prd-mermaid-renderer__line-numbers" aria-hidden="true">
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mermaid-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mermaid-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            spellCheck={false}
            rows={lineCount}
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
              onClick={() => setLightbox(true)}
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

      {resizable && ['nw', 'ne', 'sw', 'se'].map((corner) => (
        <div
          key={corner}
          className={`prd-mermaid-renderer__handle prd-mermaid-renderer__handle--${corner}`}
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
