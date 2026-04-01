import { useCallback, useLayoutEffect, useRef, useState } from 'react';

const MARGIN = 12;
/** 與 .prd-floating-action-bubble 與錨點間距一致（top/bottom: calc(100% + 6px)） */
const GAP = 6;

/**
 * 依視窗邊界調整浮層相對錨點（offsetParent）的顯示方向。
 *
 * @param {'above'|'below'} preferredVertical
 * @param {'left'|'right'} preferredHorizontal
 * @param {{ vertical?: boolean, horizontal?: boolean }} [options]
 */
export function useViewportFit(preferredVertical, preferredHorizontal = 'left', options = {}) {
  const enableV = options.vertical !== false;
  const enableH = options.horizontal !== false;
  const ref = useRef(null);
  const [vertical, setVertical] = useState(preferredVertical);
  const [horizontal, setHorizontal] = useState(preferredHorizontal);

  const adjust = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const anchor = el.offsetParent;
    if (!anchor) return;

    const vh = window.innerHeight;
    const vw = window.innerWidth;
    const ar = anchor.getBoundingClientRect();
    const mr = el.getBoundingClientRect();
    const estH = Math.max(mr.height, el.scrollHeight, 48);

    const spaceBelow = vh - ar.bottom - MARGIN;
    const spaceAbove = ar.top - MARGIN;

    let v = preferredVertical;
    if (enableV) {
      if (preferredVertical === 'below') {
        // 下方放不下時改到上方（含「上下剩餘空間相等」時也翻轉，避免貼底時判斷失準）
        if (spaceBelow < estH + GAP && spaceAbove >= spaceBelow) v = 'above';
      } else {
        // 優先上方時：預測氣泡頂邊是否會超出視窗頂，或上方淨空不足
        const bubbleTopIfAbove = ar.top - GAP - estH;
        const aboveInsufficient =
          bubbleTopIfAbove < MARGIN || spaceAbove < estH + GAP;
        // 用 >= 避免 spaceAbove === spaceBelow 時無法改到下方（貼頂選取常見）
        if (aboveInsufficient && spaceBelow >= spaceAbove) v = 'below';
      }
    }

    let h = preferredHorizontal;
    if (enableH) {
      if (preferredHorizontal === 'left') {
        if (mr.right > vw - MARGIN || mr.left < MARGIN) h = 'right';
      } else if (mr.left < MARGIN || mr.right > vw - MARGIN) {
        h = 'left';
      }
    }

    setVertical(v);
    setHorizontal(h);
  }, [preferredVertical, preferredHorizontal, enableV, enableH]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- adjust 量測錨點與浮層後同步翻轉方向
    adjust();
    const raf = requestAnimationFrame(adjust);
    const el = ref.current;
    const ro = el ? new ResizeObserver(adjust) : null;
    if (el) ro.observe(el);
    window.addEventListener('resize', adjust);
    window.addEventListener('scroll', adjust, true);
    return () => {
      cancelAnimationFrame(raf);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', adjust);
      window.removeEventListener('scroll', adjust, true);
    };
  }, [adjust]);

  return { ref, vertical, horizontal };
}
