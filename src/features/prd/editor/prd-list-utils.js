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
