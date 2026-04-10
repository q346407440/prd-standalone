/**
 * 表格儲存格內：將行內 `![](url)` 從一段 text markdown 拆成獨立 image 元素，
 * 與飛書同步（createCellContentNodes）及序列化 `<br>` 分段預期一致。
 *
 * 僅處理標準 GFM `![alt](src)`；不含匹配時回傳單一 text。
 */

const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/**
 * @param {string} markdown
 * @returns {Array<{ type: 'text', markdown: string } | { type: 'image', src: string }>}
 */
export function splitMarkdownByInlineImages(markdown) {
  const s = String(markdown ?? '');
  if (!s) {
    return [{ type: 'text', markdown: '' }];
  }

  const matches = [...s.matchAll(new RegExp(INLINE_IMAGE_RE.source, 'g'))];
  if (matches.length === 0) {
    return [{ type: 'text', markdown: s }];
  }

  const out = [];
  let lastIndex = 0;
  for (const m of matches) {
    if (m.index > lastIndex) {
      const before = s.slice(lastIndex, m.index);
      if (before) out.push({ type: 'text', markdown: before });
    }
    out.push({ type: 'image', src: String(m[2] ?? '').trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) {
    const after = s.slice(lastIndex);
    if (after) out.push({ type: 'text', markdown: after });
  }

  return out.length > 0 ? out : [{ type: 'text', markdown: s }];
}

/**
 * 由純字串建立儲存格（舊格式字串格、TableBlock 正規化用），
 * 與 parseCellElement 中行內圖拆分規則一致。
 *
 * @param {string} s
 * @returns {{ elements: Array<{ type: 'text', markdown: string } | { type: 'image', src: string }> }}
 */
export function cellFromMarkdownString(s) {
  return { elements: splitMarkdownByInlineImages(String(s ?? '')) };
}
