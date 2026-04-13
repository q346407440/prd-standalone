/**
 * 表格儲存格內：將行內 `![](url)` 從一段 text markdown 拆成獨立 image 元素，
 * 與飛書同步（createCellContentNodes）及序列化 `<br>` 分段預期一致。
 *
 * 僅處理標準 GFM `![alt](src)`；不含匹配時回傳單一 text。
 *
 * **不可**拆「單行列表前綴 + 行內圖」：`parseCellContent` 對連續列表行逐行處理時，
 * 若拆成 `text: '  - '` 與 `image` 兩個元素，預覽會變成「只有項目符號一行、圖片另起一塊」的斷裂。
 */

import { parseListPrefix } from './prd-list-utils.js';

const INLINE_IMAGE_RE = /!\[([^\]]*)\]\(([^)]+)\)/g;

/** 圖與圖之間僅換行/空白時不生成 text 節點，避免格內出現空編輯塊與佔位符。 */
function isIgnorableBetweenImages(s) {
  return /^[\s\n]*$/.test(s ?? '');
}

/**
 * @param {string} markdown
 * @returns {Array<{ type: 'text', markdown: string } | { type: 'image', src: string }>}
 */
export function splitMarkdownByInlineImages(markdown) {
  const s = String(markdown ?? '');
  if (!s) {
    return [{ type: 'text', markdown: '' }];
  }

  // 單行且整行符合列表前綴語義時保留整行，避免前綴與 `![](…)` 被拆成兩個儲存格元素。
  if (!/[\r\n]/.test(s) && parseListPrefix(s.trimEnd())) {
    return [{ type: 'text', markdown: s }];
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
      if (before && !isIgnorableBetweenImages(before)) {
        out.push({ type: 'text', markdown: before });
      }
    }
    out.push({ type: 'image', src: String(m[2] ?? '').trim() });
    lastIndex = m.index + m[0].length;
  }
  if (lastIndex < s.length) {
    const after = s.slice(lastIndex);
    if (after && !isIgnorableBetweenImages(after)) {
      out.push({ type: 'text', markdown: after });
    }
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
