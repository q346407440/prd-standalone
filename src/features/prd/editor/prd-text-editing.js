export function wrapSelectionWithBold(text, start, end) {
  if (text == null || start == null || end == null || start >= end) return null;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const before = text.slice(0, s);
  const mid = text.slice(s, e);
  const after = text.slice(e);
  const next = `${before}**${mid}**${after}`;
  return { next, selStart: s + 2, selEnd: s + 2 + mid.length };
}

/**
 * 當瀏覽器把 caret 解析到容器祖先（常見於 table cell）時，caret API 的節點不在
 * `container` 內，`contains` 失敗後若只用外接矩形會把游標固定到行尾。
 * 此函數在容器子樹內用幾何距離找最接近點擊處的字元邊界 offset。
 */
function getClosestTextOffsetInContainer(container, clientX, clientY) {
  if (!container || typeof document === 'undefined') return null;
  const totalLength = container.textContent?.length ?? 0;
  if (totalLength === 0) return 0;

  let bestOffset = 0;
  let bestDist = Infinity;
  let prefixLen = 0;
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let textNode;
  while ((textNode = walker.nextNode())) {
    const len = textNode.nodeValue.length;
    for (let i = 0; i <= len; i += 1) {
      const r = document.createRange();
      r.setStart(textNode, i);
      r.setEnd(textNode, i);
      const rect = r.getBoundingClientRect();
      const cx = rect.left;
      const cy = rect.top + rect.height / 2;
      const d = (clientX - cx) ** 2 + (clientY - cy) ** 2;
      if (d < bestDist) {
        bestDist = d;
        bestOffset = prefixLen + i;
      }
    }
    prefixLen += len;
  }
  return Math.max(0, Math.min(bestOffset, totalLength));
}

export function getTextOffsetFromPoint(container, clientX, clientY) {
  if (!container || typeof document === 'undefined') return null;
  const totalLength = container.textContent?.length ?? 0;
  let range = null;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  } else if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  }
  if (range && container.contains(range.startContainer)) {
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(container);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    return Math.max(0, Math.min(prefixRange.toString().length, totalLength));
  }
  const closest = getClosestTextOffsetInContainer(container, clientX, clientY);
  if (closest != null) return closest;
  const rect = container.getBoundingClientRect();
  if (clientX <= rect.left) return 0;
  if (clientX >= rect.right) return totalLength;
  return totalLength;
}

export function getShortcutBlockLevel(e) {
  if (!(e.altKey && (e.metaKey || e.ctrlKey))) return null;
  if (e.key === '0') return 'paragraph';
  if (/^[1-7]$/.test(e.key)) return `h${e.key}`;
  return null;
}

export function matchesShiftDigitShortcut(e, digit) {
  return e.shiftKey
    && (e.metaKey || e.ctrlKey)
    && (e.code === `Digit${digit}` || e.key === String(digit));
}
