import { useState, useCallback, useEffect, useRef } from 'react';
import {
  LIGHTBOX_ZOOM_STEP,
  LIGHTBOX_ZOOM_MIN,
  LIGHTBOX_ZOOM_MAX,
  LIGHTBOX_ZOOM_PRESETS,
} from '../prd-constants.js';

export function PrdLightbox({ imageSrc, htmlContent, onClose }) {
  const [scale, setScale] = useState(null);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(null);
  const contentRef = useRef(null);
  const fitScaleRef = useRef(1);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const padX = 80;
      const padY = 120;
      const viewW = window.innerWidth - padX * 2;
      const viewH = window.innerHeight - padY * 2;
      const fit = Math.min(viewW / rect.width, viewH / rect.height, 1);
      const rounded = Math.round(fit * 100) / 100;
      fitScaleRef.current = rounded;
      setScale(rounded);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -LIGHTBOX_ZOOM_STEP : LIGHTBOX_ZOOM_STEP;
      return Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, prev + delta));
    });
  }, []);

  useEffect(() => {
    const el = contentRef.current?.parentElement;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleBackdropMouseDown = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
      return;
    }
    setDragging(true);
    dragStartRef.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
  }, [onClose, translate]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      if (!dragStartRef.current) return;
      setTranslate({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    };
    const onUp = () => {
      setDragging(false);
      dragStartRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(LIGHTBOX_ZOOM_MAX, prev + LIGHTBOX_ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(LIGHTBOX_ZOOM_MIN, prev - LIGHTBOX_ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setScale(fitScaleRef.current);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleZoomPreset = useCallback((preset) => {
    setScale(preset);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') handleZoomIn();
      if (e.key === '-') handleZoomOut();
      if (e.key === '0') handleZoomReset();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleZoomReset]);

  const displayPercent = Math.round(scale * 100);
  const [inputValue, setInputValue] = useState(String(displayPercent));
  const inputRef = useRef(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(String(displayPercent));
    }
  }, [displayPercent]);

  const handleInputCommit = useCallback(() => {
    const num = parseInt(inputValue, 10);
    if (!isNaN(num) && num >= Math.round(LIGHTBOX_ZOOM_MIN * 100) && num <= Math.round(LIGHTBOX_ZOOM_MAX * 100)) {
      setScale(num / 100);
    }
    setInputValue(String(Math.round(scale * 100)));
  }, [inputValue, scale]);

  return (
    <div className="prd-lightbox prd-lightbox--enhanced" onMouseDown={handleBackdropMouseDown}>
      <div
        className="prd-lightbox-controls"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomOut} title="缩小">
          −
        </button>
        {LIGHTBOX_ZOOM_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`prd-lightbox-controls__preset${scale === p ? ' prd-lightbox-controls__preset--active' : ''}`}
            onClick={() => handleZoomPreset(p)}
          >
            {Math.round(p * 100)}%
          </button>
        ))}
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomIn} title="放大">
          +
        </button>
        <input
          ref={inputRef}
          type="text"
          className="prd-lightbox-controls__input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={handleInputCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
          onFocus={(e) => e.target.select()}
        />
        <span className="prd-lightbox-controls__input-suffix">%</span>
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomReset} title="重置">
          重置
        </button>
        <button type="button" className="prd-lightbox-controls__btn prd-lightbox-controls__close" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>

      {scale === null && (
        <div className="prd-lightbox-loading">
          <span className="prd-lightbox-loading__spinner" />
        </div>
      )}
      <div
        ref={contentRef}
        className="prd-lightbox-content"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale ?? 1})`,
          cursor: dragging ? 'grabbing' : 'grab',
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        {imageSrc
          ? <img src={imageSrc} alt="放大查看" draggable={false} className="prd-lightbox-content__img" />
          : <div className="prd-lightbox-content__html" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        }
      </div>
    </div>
  );
}
