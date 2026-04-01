import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { BsArrowUpShort, BsArrowDownShort } from 'react-icons/bs';
import {
  copyImageToClipboard,
  cutImageToClipboard,
  uploadPastedImage,
  getImageFromPaste,
} from '../../prd-api.js';
import { PrdLightbox } from '../PrdLightbox.jsx';

const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'];

export function ImageRenderer({
  element,
  onUpdate,
  onDelete,
  isSelected,
  onSelect,
  initialWidthPx,
  onWidthChange,
  onEnter,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onAnnotate,
  annotationCount = 0,
}) {
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [widthPx, setWidthPx] = useState(initialWidthPx ?? null);
  const [imgSrc, setImgSrc] = useState(element.src);
  const imgRef = useRef(null);
  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const retryCountRef = useRef(0);

  const showSelectedTools = isSelected && !uploading;

  useEffect(() => {
    setImgSrc(element.src);
    setImgLoaded(false);
    retryCountRef.current = 0;
  }, [element.src]);

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setImgLoaded(true);
    }
  });

  useEffect(() => {
    if (isSelected) rootRef.current?.focus();
  }, [isSelected]);

  const handlePaste = useCallback(async (e) => {
    const file = getImageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    setUploading(true);
    try {
      const path = await uploadPastedImage(file);
      onUpdate({ type: 'image', src: path });
    } catch (err) {
      console.error('图片上传失败', err);
    } finally {
      setUploading(false);
    }
  }, [onUpdate]);

  const handleResizeMouseDown = useCallback((e, corner) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const startW = img.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startW, corner };

    const onMove = (ev) => {
      const { startX, startW: sw, corner: c } = dragRef.current;
      const dx = ev.clientX - startX;
      const delta = (c === 'nw' || c === 'sw') ? -dx : dx;
      const nextW = Math.max(80, Math.round(sw + delta));
      dragRef.current._lastW = nextW;
      setWidthPx(nextW);
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
  }, [onWidthChange]);

  const imgStyle = widthPx != null ? { width: widthPx } : { width: '100%' };

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'prd-image-renderer',
          isSelected ? 'prd-image-renderer--selected' : '',
        ].filter(Boolean).join(' ')}
        tabIndex={0}
        onMouseDown={(e) => {
          const currentTarget = e.currentTarget;
          if (isSelected) {
            e.stopPropagation();
            setLightbox(true);
          } else {
            onSelect?.();
            requestAnimationFrame(() => currentTarget.focus());
          }
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            e.stopPropagation();
            void copyImageToClipboard(imgSrc);
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            e.stopPropagation();
            void cutImageToClipboard(imgSrc, onDelete);
            return;
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            onDelete?.();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onEnter?.();
          }
        }}
        onPaste={handlePaste}
        data-prd-no-block-select
      >
        {uploading ? (
          <div className="prd-image-renderer__uploading">上传中…</div>
        ) : (
          <div className="prd-image-renderer__img-wrap">
            {!imgLoaded && (
              <div className="prd-image-renderer__loading">
                <div className="prd-image-renderer__loading-spinner" />
                <span>图片加载中…</span>
              </div>
            )}
            <img
              ref={imgRef}
              src={imgSrc}
              alt="图片"
              className="prd-image-renderer__img"
              style={{ ...imgStyle, ...(imgLoaded ? {} : { width: 0, height: 0, position: 'absolute', opacity: 0 }) }}
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                if (retryCountRef.current >= 2 || !element.src) {
                  setImgLoaded(true);
                  return;
                }
                retryCountRef.current += 1;
                window.setTimeout(() => {
                  setImgSrc(`${element.src}${element.src.includes('?') ? '&' : '?'}t=${Date.now()}`);
                }, 300);
              }}
            />

            {showSelectedTools && RESIZE_HANDLES.map((corner) => (
              <div
                key={corner}
                className={`prd-image-renderer__handle prd-image-renderer__handle--${corner}`}
                onMouseDown={(e) => handleResizeMouseDown(e, corner)}
              />
            ))}

            {showSelectedTools && (
              <div className="prd-image-renderer__overlay-toolbar">
                {onAnnotate && (
                  <button
                    type="button"
                    className="prd-action-btn prd-image-renderer__overlay-label"
                    title="标注"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAnnotate();
                    }}
                  >
                    标注{annotationCount > 0 ? `(${annotationCount})` : ''}
                  </button>
                )}
                <button
                  type="button"
                  className="prd-action-btn prd-image-renderer__overlay-btn"
                  title="上移"
                  disabled={!canMoveUp}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (canMoveUp) onMoveUp?.();
                  }}
                >
                  <BsArrowUpShort aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="prd-action-btn prd-image-renderer__overlay-btn"
                  title="下移"
                  disabled={!canMoveDown}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (canMoveDown) onMoveDown?.();
                  }}
                >
                  <BsArrowDownShort aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="prd-action-btn prd-action-btn--danger"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {lightbox && createPortal(
        <PrdLightbox imageSrc={imgSrc} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </>
  );
}
