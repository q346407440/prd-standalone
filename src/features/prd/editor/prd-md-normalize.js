/**
 * 打开 / 解析前对磁盘正文做规范化：先 island end，再剥 prose block 标记。
 */

import { ensureIslandEndMarkers } from './prd-island-block-markers.js';
import { stripLegacyProseBlockMarkers } from './prd-prose-legacy-migration.js';

/**
 * @param {string} md
 * @returns {string}
 */
export function normalizePrdMdForLoad(md) {
  if (typeof md !== 'string' || md.length === 0) return md;
  return stripLegacyProseBlockMarkers(ensureIslandEndMarkers(md));
}
