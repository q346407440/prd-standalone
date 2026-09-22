/**
 * 去掉历史 v2 中 title（h1–h7）与 paragraph 的 block 起始行，保留正文。
 * 不处理 table / mermaid / mindmap / divider 等其它 block 标记。
 */

/** 与 island opening 一致，注释以 `-->` 闭合 */
const LEGACY_PROSE_BLOCK_LINE_RE = /^<!--\s*block:(h[1-7]|paragraph)\s*-->$/;

/**
 * @param {string} md
 * @returns {string}
 */
export function stripLegacyProseBlockMarkers(md) {
  if (typeof md !== 'string' || md.length === 0) return md;
  return md
    .split('\n')
    .filter((line) => !LEGACY_PROSE_BLOCK_LINE_RE.test(line.trim()))
    .join('\n');
}
