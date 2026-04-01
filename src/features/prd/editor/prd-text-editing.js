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
