import { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
  copyImageToClipboard,
  cutImageToClipboard,
  uploadPastedImage,
  getImageFromPaste,
} from '../../prd-api.js';
import { PrdLightbox } from '../PrdLightbox.jsx';
import { useActiveSlug } from '../../active-slug-context.jsx';

/**
 * 把 MD 源里的相对路径 ./assets/x.png 解析成浏览器可加载的 URL。
 * 兼容三种格式（与后端 resolveImagePathOnDisk 对应）：
 *   - ./assets/<file>           → /pages/<activeSlug>/assets/<file>
 *   - /pages/doc-XXX/assets/x   → 原样
 *   - /prd/x                    → 原样（兼容期）
 *   - http(s) / data: / 其它    → 原样
 */
function resolveImgUrlForBrowser(src, activeSlug) {
  if (typeof src !== 'string' || !src) return src;
  if (src.startsWith('./assets/') || src.startsWith('assets/')) {
    if (!activeSlug) return src;
    const tail = src.replace(/^\.?\//, '').slice('assets/'.length);
    return `/pages/${activeSlug}/assets/${tail}`;
  }
  return src;
}

const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'];

export function ImageRenderer({
  element,
  onUpdate,
  onDelete,
  isSelected,
  onSelect,
  /** 用於與 globalSelection 對齊，避免 hover 未選中圖片時打開 block 級操作欄 */
  selectionKey = 'block',
  initialWidthPx,
  onWidthChange,
  onEnter,
  onAnnotate,
  annotationCount = 0,
  prdAssetCacheBust = 0,
  fillContainerByDefault = true,
}) {
  const activeSlug = useActiveSlug();
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [widthPx, setWidthPx] = useState(initialWidthPx ?? null);
  const bustedSrc = useCallback((src, bust) => {
    const resolved = resolveImgUrlForBrowser(src, activeSlug);
    if (!resolved || !bust) return resolved;
    // 任何本地 PRD 图（/prd/、/pages/.../assets/）都参与 cache-bust
    if (!/^\/(?:prd|pages\/doc-\d+\/assets)\//.test(resolved)) return resolved;
    const sep = resolved.includes('?') ? '&' : '?';
    return `${resolved}${sep}v=${bust}`;
  }, [activeSlug]);
  const [imgSrc, setImgSrc] = useState(() => bustedSrc(element.src, prdAssetCacheBust));
  const imgRef = useRef(null);
  const rootRef = useRef(null);
  const dragRef = useRef(null);
  const retryCountRef = useRef(0);

  const showSelectedTools = isSelected && !uploading;

  useEffect(() => {
    setImgSrc(bustedSrc(element.src, prdAssetCacheBust));
    setImgLoaded(false);
    retryCountRef.current = 0;
  }, [element.src, prdAssetCacheBust, bustedSrc]);

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setImgLoaded(true);
    }
  }, [imgSrc]);

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
      const path = await uploadPastedImage(file, activeSlug);
      onUpdate({ type: 'image', src: path });
    } catch (err) {
      console.error('图片上传失败', err);
    } finally {
      setUploading(false);
    }
  }, [onUpdate, activeSlug]);

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

  const imgStyle = widthPx != null
    ? { width: widthPx }
    : (fillContainerByDefault ? { width: '100%' } : { width: 'auto', maxWidth: '100%' });

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'prd-image-renderer',
          isSelected ? 'prd-image-renderer--selected' : '',
        ].filter(Boolean).join(' ')}
        data-prd-img-sel={selectionKey}
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
              alt={element.alt || '图片'}
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
                  const base = bustedSrc(element.src, prdAssetCacheBust);
                  setImgSrc(`${base}${base.includes('?') ? '&' : '?'}t=${Date.now()}`);
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

            {showSelectedTools && onAnnotate && (
              <div className="prd-image-renderer__overlay-toolbar">
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
