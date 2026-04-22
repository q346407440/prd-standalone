export const LIST_PREFIX_RE = /^(\s*)([-*+]|\d+\.|[a-z]+\.)(?:\s([\s\S]*))?$/;

export function parseListPrefix(md) {
  if (!md) return null;
  const match = md.match(LIST_PREFIX_RE);
  if (!match) return null;
  return {
    indent: match[1],
    marker: match[2],
    body: match[3] ?? '',
    prefix: `${match[1]}${match[2]} `,
  };
}

export function applyListPrefix(inlineMd, prefix) {
  if (!prefix) return inlineMd;
  return prefix + inlineMd;
}

/**
 * Tiptap 將多個段落序列化為以 \\n\\n 分隔的 Markdown；本編輯器對整塊正文只保留「單一」外層列表前綴。
 * 若直接用 {@link applyListPrefix}，只會在全文開頭加一次前綴，其餘段落會變成無前綴 + 空行，
 * 與預覽/源文件不一致，且空行會觸發載入時 expandParagraphBlocksOnBlankLines 拆成多個 paragraph block。
 *
 * 對每個由 \\n\\n 切出的段落：若其首行已符合列表前綴則保留；否則在該段前補上同一個 prefix。
 * 段落之間用單一 \\n 拼接，避免產生「空行」。
 */
export function mergeListPrefixWithParagraphMarkdown(serializedMd, prefix) {
  if (!prefix) return serializedMd ?? '';
  const normalized = String(serializedMd ?? '').replace(/\n+$/, '');
  if (!normalized.trim()) {
    return prefix.endsWith(' ') ? prefix : `${prefix} `;
  }
  const parts = normalized
    .split(/\n\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length <= 1) {
    return applyListPrefix(normalized, prefix);
  }
  return parts
    .map((part) => {
      const firstLine = part.split(/\n/)[0] ?? '';
      if (parseListPrefix(firstLine)) {
        return part;
      }
      return prefix + part;
    })
    .join('\n');
}

export function indentMarkdown(md) {
  if (!md) return md;
  return md.replace(/^/gm, '  ');
}

export function dedentMarkdown(md) {
  if (!md) return md;
  return md.replace(/^( {2}|\t)/gm, '');
}

export function hasListPrefix(md) {
  return LIST_PREFIX_RE.test(md || '');
}

export function hasIndent(md) {
  return /^\s{2,}/.test(md || '');
}

/**
 * 根据「前一个 paragraph block 的 markdown」给出当前 block **首行**允许的最大 indent level。
 *
 * 规则（与飞书同步端 descendant 父子链上限一致）：
 *   - 前一 block 不是 paragraph（heading / divider / table / paragraph-image / 无前置）→ 返回 0，
 *     即当前 block 首行不能缩进（没有合法父可挂靠）；
 *   - 前一 block 是 paragraph(text)：取其末尾非空行的 list level（非 list 行视作 0），+1 作为上限；
 *     例如末行 `- xxx`（level 0）→ 当前 block 首行 max = 1；末行 `    - xxx`（level 2）→ max = 3。
 *
 * 调用方：用这个返回值作为编辑器 Tab 拦截的 ceiling，Tab 想再缩一级时若当前已达上限则不响应。
 */
export function computeFirstLineIndentCeiling(prevParagraphMarkdown) {
  if (prevParagraphMarkdown == null) return 0;
  const lines = String(prevParagraphMarkdown).split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const parsed = parseListPrefix(lines[i]);
    const level = parsed ? Math.floor(parsed.indent.length / 2) : 0;
    return level + 1;
  }
  return 0;
}

/**
 * 给定一段 paragraph markdown 与「行索引 i」，返回**该行**允许的最大 indent level。
 *
 * 规则：
 *   - i === 0：上限由外部传入的 firstLineCeiling 决定（通常来自 computeFirstLineIndentCeiling）；
 *   - i > 0：取第 i 行之前最后一个非空行的 level（非 list 行视作 0），+1 作为上限。
 *
 * 调用方：ParagraphLinesEditor 在多行编辑场景下，给每一行算出独立的 maxIndentLevel 下发到
 * 每行的 TiptapMarkdownEditor。
 */
export function computeLineIndentCeiling(markdown, lineIdx, firstLineCeiling = 0) {
  if (lineIdx <= 0) return firstLineCeiling;
  const lines = String(markdown || '').split('\n');
  for (let i = Math.min(lineIdx, lines.length) - 1; i >= 0; i--) {
    if (!lines[i].trim()) continue;
    const parsed = parseListPrefix(lines[i]);
    const level = parsed ? Math.floor(parsed.indent.length / 2) : 0;
    return level + 1;
  }
  return firstLineCeiling;
}

/**
 * 把 paragraph block 的 markdown 里的「非法列表缩进」规整到合法层级。
 *
 * 规则（与飞书同步端 buildDescendantFromRawNodes 的 clamp 规则一致）：
 *   1) 首行（该 block 的第一个非空行）必须 level = 0——paragraph block 没有上文父可挂靠；
 *   2) 其后任何 list 行的 indent level ≤ 前一非空行 level + 1，超过时 clamp；
 *   3) 非 list 行（普通正文）视作 level 0，作为后续 list 行的参考基准；
 *   4) ``` ``` 代码块内部不做处理，避免示例代码被误当成 list 行规整。
 *
 * 前端写回磁盘前调用：阻止用户/Agent 在 paragraph block 里写出「前置无合法父」的
 * 孤儿缩进——避免同步飞书 / 离线导出时出现非法层级或渲染错乱。
 *
 * 仅改动被 clamp 的 list 行的首行空格，不改变 marker 与 body；不在 list 行上做 clamp
 * 的行（普通文本、代码、空行）完全保留原样。
 */
export function clampParagraphListIndent(markdown) {
  if (!markdown) return markdown;
  const lines = String(markdown).split('\n');
  let inFence = false;
  let prevLevel = 0;
  let seenFirstRealLine = false;
  let mutated = false;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    if (!line.trim()) continue;
    const parsed = parseListPrefix(line);
    if (!parsed) {
      prevLevel = 0;
      seenFirstRealLine = true;
      continue;
    }
    const rawLevel = Math.floor(parsed.indent.length / 2);
    const maxAllowed = seenFirstRealLine ? prevLevel + 1 : 0;
    const clamped = Math.min(rawLevel, maxAllowed);
    const newIndentLen = clamped * 2;
    if (newIndentLen !== parsed.indent.length) {
      // 只替换首行空格，marker / body / 尾部空格一律保留原样
      lines[i] = ' '.repeat(newIndentLen) + line.slice(parsed.indent.length);
      mutated = true;
    }
    prevLevel = clamped;
    seenFirstRealLine = true;
  }
  return mutated ? lines.join('\n') : markdown;
}

function nextAlpha(alpha) {
  let carry = 1;
  const chars = alpha.split('');
  for (let i = chars.length - 1; i >= 0 && carry; i--) {
    const code = chars[i].charCodeAt(0) - 96 + carry;
    if (code > 26) {
      chars[i] = 'a';
      carry = 1;
    } else {
      chars[i] = String.fromCharCode(96 + code);
      carry = 0;
    }
  }
  if (carry) chars.unshift('a');
  return chars.join('');
}

export function incrementMarker(marker) {
  if (/^\d+\.$/.test(marker)) return `${parseInt(marker, 10) + 1}.`;
  if (/^[a-z]+\.$/.test(marker)) return `${nextAlpha(marker.slice(0, -1))}.`;
  return marker;
}

export function numToAlphaMarker(num) {
  let next = num;
  let result = '';
  while (next > 0) {
    next--;
    result = String.fromCharCode(97 + (next % 26)) + result;
    next = Math.floor(next / 26);
  }
  return `${result}.`;
}

export function alphaToNum(alpha) {
  let num = 0;
  for (let i = 0; i < alpha.length; i++) {
    num = num * 26 + (alpha.charCodeAt(i) - 96);
  }
  return num;
}

export function adjustOrderedMarkerAfterIndent(md) {
  const parsed = parseListPrefix(md);
  if (!parsed || !/^(\d+\.|[a-z]+\.)$/.test(parsed.marker)) return md;
  // 缩进层级切换时，统一重置为该层的起始 marker。
  const indentLevel = Math.floor(parsed.indent.length / 2);
  const nextMarker = indentLevel % 2 === 1 ? 'a.' : '1.';
  return `${parsed.indent}${nextMarker} ${parsed.body}`;
}

/**
 * 键盘快捷（Shift+7/8）在无序 / 有序列表间切换时保留行首缩进，与 Tab 缩进子列表一致。
 * @param {'bullet' | 'ordered' | 'off'} target
 */
export function switchMarkdownListKind(fullMd, target) {
  const parsed = parseListPrefix(fullMd ?? '');
  const body = parsed ? (parsed.body ?? '') : (fullMd ?? '');
  const indent = parsed?.indent ?? '';

  if (target === 'off') {
    return body;
  }
  if (target === 'bullet') {
    return `${indent}- ${body}`;
  }
  if (target === 'ordered') {
    return adjustOrderedMarkerAfterIndent(`${indent}1. ${body}`);
  }
  return fullMd ?? '';
}

export function inferListPrefix(md) {
  if (!md) return null;
  const parsed = parseListPrefix(md);
  if (!parsed) return null;
  if (/^[-*+]$/.test(parsed.marker)) return `${parsed.indent}- `;
  if (/^\d+\.$/.test(parsed.marker) || /^[a-z]+\.$/.test(parsed.marker)) {
    return `${parsed.indent}${incrementMarker(parsed.marker)} `;
  }
  return null;
}

export function isSameLayerOrdered(md, targetIndent) {
  const parsed = parseListPrefix(md);
  if (!parsed || parsed.indent !== targetIndent) return false;
  return /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

export function isEmptyOrderedListMd(md) {
  const parsed = parseListPrefix(md);
  return !!parsed
    && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker)
    && (parsed.body ?? '').trim() === '';
}

export function isBareListPrefixMd(md) {
  const parsed = parseListPrefix(md);
  return !!parsed && (parsed.body ?? '').trim() === '';
}

export function replaceListPrefixMd(md, nextPrefix) {
  const parsed = parseListPrefix(md);
  const body = parsed ? (parsed.body ?? '') : (md ?? '');
  return `${nextPrefix}${body}`;
}

function getTraversalMode(item, isCompatibleItem, shouldSkipItem) {
  if (isCompatibleItem(item)) return 'compatible';
  if (shouldSkipItem(item)) return 'skip';
  return 'stop';
}

export function findOrderedGroupStart(items, changedIdx, options) {
  const {
    getMarkdown,
    isCompatibleItem,
    shouldSkipItem = () => false,
  } = options;
  const currentItem = items[changedIdx];
  if (!isCompatibleItem(currentItem)) return null;
  const currentMd = getMarkdown(currentItem);
  const parsed = parseListPrefix(currentMd);
  if (!parsed || !/^(\d+\.|[a-z]+\.)$/.test(parsed.marker)) return null;

  // 只在“同层连续有序列表”内找组头；更深缩进视为子列表，允许跨过。
  const targetIndent = parsed.indent;
  let start = changedIdx;

  while (start > 0) {
    const prevItem = items[start - 1];
    const mode = getTraversalMode(prevItem, isCompatibleItem, shouldSkipItem);
    if (mode === 'skip') {
      start--;
      continue;
    }
    if (mode === 'stop') break;

    const prevMd = getMarkdown(prevItem);
    const prevParsed = parseListPrefix(prevMd);
    if (!prevParsed) break;
    if (prevParsed.indent.length > targetIndent.length) {
      start--;
      continue;
    }
    if (isSameLayerOrdered(prevMd, targetIndent)) {
      start--;
      continue;
    }
    break;
  }

  while (start < changedIdx) {
    const item = items[start];
    const mode = getTraversalMode(item, isCompatibleItem, shouldSkipItem);
    if (mode === 'skip') {
      start++;
      continue;
    }
    if (mode === 'stop') return null;
    if (isSameLayerOrdered(getMarkdown(item), targetIndent)) break;
    start++;
  }

  const startItem = items[start];
  if (!isCompatibleItem(startItem)) return null;
  const startParsed = parseListPrefix(getMarkdown(startItem));
  const startNum = startParsed
    ? (/^\d+\.$/.test(startParsed.marker)
      ? parseInt(startParsed.marker, 10)
      : alphaToNum(startParsed.marker.slice(0, -1)))
    : 1;

  return { startIdx: start, startNum, targetIndent };
}

export function renumberOrderedItemsFrom(items, startIdx, targetIndent, startNum, options) {
  const {
    getMarkdown,
    setMarkdown,
    isCompatibleItem,
    shouldSkipItem = () => false,
  } = options;
  const useAlpha = (targetIndent.length / 2) % 2 === 1;
  const result = [...items];
  let changed = false;
  let seq = startNum;

  // 统一的续号规则：偶数层数字，奇数层字母；遇到真正断链才停止。
  for (let i = startIdx; i < result.length; i++) {
    const item = result[i];
    const mode = getTraversalMode(item, isCompatibleItem, shouldSkipItem);
    if (mode === 'skip') continue;
    if (mode === 'stop') break;

    const md = getMarkdown(item);
    const parsed = parseListPrefix(md);
    if (!parsed) break;
    if (parsed.indent.length > targetIndent.length) continue;
    if (!isSameLayerOrdered(md, targetIndent)) break;

    const expectedMarker = useAlpha ? numToAlphaMarker(seq) : `${seq}.`;
    if (parsed.marker !== expectedMarker) {
      result[i] = setMarkdown(item, `${targetIndent}${expectedMarker} ${parsed.body}`);
      changed = true;
    }
    seq++;
  }

  return changed ? result : null;
}

export function renumberOrderedGroupAt(items, changedIdx, options) {
  const {
    getMarkdown,
    setMarkdown,
    isCompatibleItem,
    shouldSkipItem = () => false,
  } = options;
  const group = findOrderedGroupStart(items, changedIdx, {
    getMarkdown,
    isCompatibleItem,
    shouldSkipItem,
  });
  if (!group) return items;
  const renumbered = renumberOrderedItemsFrom(
    items,
    group.startIdx,
    group.targetIndent,
    group.startNum,
    {
      getMarkdown,
      setMarkdown,
      isCompatibleItem,
      shouldSkipItem,
    },
  );
  return renumbered ?? items;
}

export function createTypedMarkdownListOptions({
  anchorItem,
  getMarkdown,
  setMarkdown,
  getItemType,
  shouldSkipItem = () => false,
}) {
  const anchorType = getItemType(anchorItem);
  return {
    getMarkdown,
    setMarkdown,
    isCompatibleItem: (item) => {
      const itemType = getItemType(item);
      return itemType != null && itemType === anchorType;
    },
    shouldSkipItem,
  };
}
