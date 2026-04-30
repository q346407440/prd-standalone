/**
 * Lightbox 中 Mermaid 根 SVG 常随容器变宽，foreignObject 内 HTML 会重排，行数可能多于成图时，
 * 但库写死的 `foreignObject@height` / 背景 `rect` 高不变，会「字换行、框不长」。
 * 用 `scrollHeight` 与当前 `foreignObject` 的屏幕高（同坐标系、含父级 transform）比出目标 user 高度，再同幅拉背景。
 * @param {SVGSVGElement} svg
 */
export function adjustMermaidFlowchartNodeSizesForView(svg) {
  if (!svg || !svg.isConnected) return;
  const viewBox = svg.viewBox?.baseVal;
  if (!viewBox) return;

  const foreignObjects = svg.querySelectorAll('foreignObject');
  for (const fo of foreignObjects) {
    const div = fo.querySelector('div');
    if (!div) continue;

    const hUser = parseFloat(fo.getAttribute('height') || '0');
    const wUser = parseFloat(fo.getAttribute('width') || '0');
    if (!hUser || !wUser) continue;

    const foRect = fo.getBoundingClientRect();
    const hOldPx = foRect.height;
    if (hOldPx < 1) continue;

    const needPx = div.scrollHeight;
    if (needPx <= hOldPx * 1.01) continue;

    const newHUser = hUser * (needPx / hOldPx);
    if (!Number.isFinite(newHUser) || newHUser < hUser * 0.5) continue;

    const delta = newHUser - hUser;
    fo.setAttribute('height', String(newHUser));

    const gNode = fo.closest('g.node');
    if (gNode) {
      const rects = [...gNode.querySelectorAll('rect')];
      const wMatch = rects.filter((r) => {
        const rw = parseFloat(r.getAttribute('width') || '0');
        return Math.abs(rw - wUser) < Math.max(2, wUser * 0.08);
      });
      const r = wMatch[0] || rects[0];
      if (r) {
        const y = parseFloat(r.getAttribute('y') || '0');
        const hR = parseFloat(r.getAttribute('height') || '0');
        if (hR > 0) {
          r.setAttribute('y', String(y - delta / 2));
          r.setAttribute('height', String(hR + delta));
        }
      }
    }
  }

  try {
    const rootG = svg.querySelector('g');
    if (!rootG) return;
    const bb = rootG.getBBox();
    if (bb && Number.isFinite(bb.x) && Number.isFinite(bb.width) && bb.width > 0) {
      const pad = 8;
      svg.setAttribute('viewBox', `${bb.x - pad} ${bb.y - pad} ${bb.width + pad * 2} ${bb.height + pad * 2}`);
    }
  } catch {
    /* 忽略 getBBox 异常 */
  }
}
