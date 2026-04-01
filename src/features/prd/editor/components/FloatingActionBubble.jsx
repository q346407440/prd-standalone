import { forwardRef, useCallback, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BUBBLE_GAP, BUBBLE_MARGIN } from '../prd-constants.js';

export const ActionPanel = forwardRef(function ActionPanel({
  visible = true, className = '', onMouseEnter, onMouseLeave, children,
}, ref) {
  return (
    <div
      ref={ref}
      data-prd-no-block-select
      className={[
        'prd-action-panel',
        visible ? 'prd-action-panel--visible' : '',
        className,
      ].filter(Boolean).join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
});

/**
 * 選取格式浮窗 / 鏈接氣泡共用。
 * 使用 Portal + position:fixed，完全不受父層 overflow / offsetParent 影響。
 * anchorRef：指向「錨點 DOM」（輸入框 / 標籤），浮窗依其 getBoundingClientRect 定位。
 * 若未傳 anchorRef，退回原本 absolute 定位（鏈接氣泡場景）。
 */
export function FloatingActionBubble({
  visible,
  preferredVertical = 'below',
  preferredHorizontal = 'left',
  /** 錨點 ref（input / textarea / span），用於 fixed 定位計算 */
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  /** 內層攔截 mousedown：鏈接氣泡傳 stopPropagation；選取工具列預設 preventDefault */
  innerMouseDown,
  /** 可選：供外部 contains 判斷（如鏈接氣泡關閉） */
  panelRef,
  className = '',
  children,
}) {
  const selfRef = useRef(null);
  const [style, setStyle] = useState(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef?.current;
    const self = selfRef.current;
    if (!anchor || !self) return;

    const ar = anchor.getBoundingClientRect();
    const sw = self.offsetWidth || 0;
    const sh = self.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    const spaceAbove = ar.top - BUBBLE_MARGIN;
    const spaceBelow = vh - ar.bottom - BUBBLE_MARGIN;
    let top;
    if (preferredVertical === 'above') {
      if (spaceAbove >= sh + BUBBLE_GAP || spaceAbove >= spaceBelow) {
        top = ar.top - BUBBLE_GAP - sh;
      } else {
        top = ar.bottom + BUBBLE_GAP;
      }
    } else {
      if (spaceBelow >= sh + BUBBLE_GAP || spaceBelow >= spaceAbove) {
        top = ar.bottom + BUBBLE_GAP;
      } else {
        top = ar.top - BUBBLE_GAP - sh;
      }
    }
    top = Math.max(BUBBLE_MARGIN, Math.min(top, vh - sh - BUBBLE_MARGIN));

    let left;
    if (preferredHorizontal === 'right') {
      left = ar.right - sw;
    } else {
      left = ar.left;
    }
    left = Math.max(BUBBLE_MARGIN, Math.min(left, vw - sw - BUBBLE_MARGIN));

    setStyle({ position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 });
  }, [anchorRef, preferredVertical, preferredHorizontal]);

  useLayoutEffect(() => {
    if (!visible || !anchorRef) return;
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [visible, anchorRef, reposition]);

  const setRef = useCallback((node) => {
    selfRef.current = node;
    if (panelRef) panelRef.current = node;
    if (node && anchorRef) reposition();
  }, [panelRef, anchorRef, reposition]);

  if (!visible) return null;

  const inner = (
    <div
      ref={anchorRef ? setRef : (node) => { selfRef.current = node; if (panelRef) panelRef.current = node; }}
      data-prd-no-block-select
      className={[
        'prd-action-panel prd-action-panel--visible',
        'prd-floating-action-bubble',
        className,
      ].filter(Boolean).join(' ')}
      style={anchorRef ? (style ?? { visibility: 'hidden', position: 'fixed' }) : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        className="prd-floating-action-bubble__inner"
        onMouseDown={innerMouseDown ?? ((e) => {
          e.preventDefault();
          e.stopPropagation();
        })}
      >
        {children}
      </span>
    </div>
  );

  if (anchorRef) {
    return createPortal(inner, document.body);
  }
  return inner;
}
