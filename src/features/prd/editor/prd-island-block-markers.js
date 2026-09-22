/**
 * 顶层 table / mermaid / mindmap 的 island 闭合标记，与 prd-parser 的 opening 行语义一致。
 */

/** 与 parseNewFormat 使用的 opening 行正则一致（含 block:table cols="..."） */
export const BLOCK_OPENING_LINE_RE = /^<!--\s*block:([\w-]+)(?:\s+(.*?))?\s*-->$/;

/** 仅 table / mermaid / mindmap 的闭合行 */
export const BLOCK_END_LINE_RE = /^<!--\s*\/block:(table|mermaid|mindmap)\s*-->$/;

export const ISLAND_BLOCK_TYPES = ['table', 'mermaid', 'mindmap'];

const ISLAND_SET = new Set(ISLAND_BLOCK_TYPES);

export function isIslandBlockType(type) {
  return ISLAND_SET.has(type);
}

/**
 * 在历史正文缺少闭合标记时，在「下一个 block opening」之前（或文末）插入匹配的 `<!-- /block:type -->`。
 * 幂等：已有正确闭合则不改；多轮扫描处理连续多个 island。
 *
 * @param {string} md
 * @returns {string}
 */
export function ensureIslandEndMarkers(md) {
  if (typeof md !== 'string' || md.length === 0) return md;
  const lines = md.split('\n');
  let guard = 0;
  const maxPasses = (lines.length + 5) * 4;

  while (guard++ < maxPasses) {
    let changed = false;
    for (let i = 0; i < lines.length; i += 1) {
      const openMatch = lines[i].trim().match(BLOCK_OPENING_LINE_RE);
      if (!openMatch || !isIslandBlockType(openMatch[1])) continue;
      const islandType = openMatch[1];

      let j = i + 1;
      let hasMatchingEnd = false;
      while (j < lines.length) {
        const tj = lines[j].trim();
        const endMatch = tj.match(BLOCK_END_LINE_RE);
        if (endMatch && endMatch[1] === islandType) {
          hasMatchingEnd = true;
          break;
        }
        if (BLOCK_OPENING_LINE_RE.test(tj)) break;
        j += 1;
      }

      if (hasMatchingEnd) continue;

      const insertLine = `<!-- /block:${islandType} -->`;
      if (j < lines.length) {
        lines.splice(j, 0, insertLine);
      } else {
        lines.push(insertLine);
      }
      changed = true;
      break;
    }
    if (!changed) break;
  }

  return lines.join('\n');
}
