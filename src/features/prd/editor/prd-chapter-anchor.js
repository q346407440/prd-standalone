/**
 * PRD 章节号锚点跳转：把正文里裸写的 `**2.1.5**` / `**2.3**` 自动识别成
 * 跳到对应 heading 的可点击链接，不需要修改 .md 写法。
 *
 * 设计要点：
 * - 不改 parser、不给 block 加字段、不写回 .md。仅在渲染时即时计算索引。
 * - 跨 h1 同号歧义按「当前所在 h1 优先 → 全局唯一回退 → 仍歧义则放弃链化」处理。
 * - 命中失败（章节号根本不存在）保持加粗原样，不报错、不打日志。
 */

const STRICT_CHAPTER_RE = /^(\d+(?:\.\d+)+)$/;
const HEADING_PREFIX_RE = /^(\d+(?:\.\d+)*)[\s.、：:]+/;

/**
 * 判定一段 strong 文本是否为「纯多段章节号」（如 `2.1.5`、`2.3`）。
 * 单段号（如 `2`）不算，避免跟「2 个」「第 2 步」之类裸数字混淆。
 * @param {string} text
 * @returns {string | null} 命中则返回章节号，不命中返回 null
 */
export function extractStrongChapterRef(text) {
  if (text == null) return null;
  const trimmed = String(text).trim();
  const m = trimmed.match(STRICT_CHAPTER_RE);
  return m ? m[1] : null;
}

/**
 * 从 heading 的 markdown 文本里抠出开头的章节号前缀。
 * 支持 `2.1.5 标题`、`2.1.5. 标题`、`2.1.5、标题`、`2.1.5：标题` 等常见分隔。
 * 单段号（如 `2 标题`、`4. 标题`）也接受——以便支持「**第 N 章**」类引用映射到 h2。
 * @param {string} headingMarkdown
 * @returns {string | null}
 */
export function extractHeadingChapterPrefix(headingMarkdown) {
  if (!headingMarkdown) return null;
  const m = String(headingMarkdown).match(HEADING_PREFIX_RE);
  return m ? m[1] : null;
}

/**
 * 基于 blocks 序列建立「章节号 → blockId」索引，并维护每个 block 所属的 h1Scope。
 *
 * 返回对象提供：
 * - `resolve(chapter, contextBlockId)`：当前 block 所在 h1 内查 → 失败则在全局唯一时回退
 * - `getH1Scope(blockId)`：返回该 block 所属 h1 的稳定 id（h1 自身的 blockId）
 *
 * @param {Array<{ id: string, type: string, content?: any }>} blocks
 */
export function buildChapterIndex(blocks) {
  // h1ScopeOfBlock: 每个 block 所属 h1 的 blockId（h1 自身映射到自己；位于任何 h1 之前的 block 映射到 null）
  const h1ScopeOfBlock = new Map();
  // perScope: Map<h1ScopeId|null, Map<chapterStr, blockId[]>>
  const perScope = new Map();
  // global: Map<chapterStr, blockId[]>
  const globalIdx = new Map();

  let currentH1 = null;

  for (const block of blocks) {
    if (block.type === 'h1') {
      currentH1 = block.id;
    }
    h1ScopeOfBlock.set(block.id, currentH1);

    if (!/^h[2-7]$/.test(block.type)) continue;
    const text = block.content?.markdown ?? block.content?.text ?? '';
    const chapter = extractHeadingChapterPrefix(text);
    if (!chapter) continue;

    if (!perScope.has(currentH1)) perScope.set(currentH1, new Map());
    const scopeMap = perScope.get(currentH1);
    if (!scopeMap.has(chapter)) scopeMap.set(chapter, []);
    scopeMap.get(chapter).push(block.id);

    if (!globalIdx.has(chapter)) globalIdx.set(chapter, []);
    globalIdx.get(chapter).push(block.id);
  }

  function resolve(chapter, contextBlockId) {
    if (!chapter) return null;
    const scopeId = contextBlockId != null ? (h1ScopeOfBlock.get(contextBlockId) ?? null) : null;
    const scopeMap = perScope.get(scopeId);
    const inScope = scopeMap?.get(chapter);
    if (inScope && inScope.length === 1) return inScope[0];
    const inGlobal = globalIdx.get(chapter);
    if (inGlobal && inGlobal.length === 1) return inGlobal[0];
    // 同 h1 内多匹配 → 取该 h1 内首个；跨 h1 多匹配且当前 h1 内无 → 放弃
    if (inScope && inScope.length > 1) return inScope[0];
    return null;
  }

  function getH1Scope(blockId) {
    return h1ScopeOfBlock.get(blockId) ?? null;
  }

  return { resolve, getH1Scope };
}
