import { DEFAULT_PRD_SLUG } from './prd-constants.js';
import { slugToMdPath } from './prd-utils.js';

function viewportSnapshotKey(slug) {
  return `prd-editor:viewport:${slugToMdPath(slug || DEFAULT_PRD_SLUG)}`;
}

export function readPersistedViewportSnapshot(slug) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(viewportSnapshotKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      scrollTop: Number(parsed.scrollTop) || 0,
      anchorIndex: Number.isInteger(parsed.anchorIndex) ? parsed.anchorIndex : null,
      anchorSignature: typeof parsed.anchorSignature === 'string' ? parsed.anchorSignature : '',
      anchorOffsetTop: Number(parsed.anchorOffsetTop) || 0,
    };
  } catch {
    return null;
  }
}

export function persistViewportSnapshot(snapshot, slug) {
  if (typeof window === 'undefined' || !snapshot) return;
  try {
    window.localStorage.setItem(
      viewportSnapshotKey(slug),
      JSON.stringify({
        scrollTop: snapshot.scrollTop ?? 0,
        anchorIndex: snapshot.anchorIndex ?? null,
        anchorSignature: snapshot.anchorSignature ?? '',
        anchorOffsetTop: snapshot.anchorOffsetTop ?? 0,
      }),
    );
  } catch {
    // 忽略 localStorage 不可用 / 超额等异常，避免影响编辑体验。
  }
}

function getCellScrollSignature(cell) {
  const elements = cell?.elements
    ?? (cell?.element ? [cell.element] : []);
  return elements.map((element) => {
    if (!element) return '';
    if (element.type === 'image') return `img:${element.src || ''}`;
    if (element.type === 'mermaid') return `mermaid:${element.code || ''}`;
    if (element.type === 'mindmap') return `mindmap:${element.code || ''}`;
    return `txt:${element.markdown || ''}`;
  }).join('<br>');
}

export function getBlockScrollSignature(block) {
  if (!block) return '';
  if (/^h[1-7]$/.test(block.type)) {
    return `${block.type}:text:${block.content?.markdown || ''}`;
  }
  if (block.type === 'paragraph') {
    if (block.content?.type === 'image') return `paragraph:image:${block.content?.src || ''}`;
    return `paragraph:text:${block.content?.markdown || ''}`;
  }
  if (block.type === 'divider') return 'divider';
  if (block.type === 'mermaid') return `mermaid:${block.content?.code || ''}`;
  if (block.type === 'mindmap') return `mindmap:${block.content?.code || ''}`;
  if (block.type === 'table') {
    const headers = block.content?.headers?.join('|') || '';
    const firstRow = block.content?.rows?.[0]?.map(getCellScrollSignature).join('|') || '';
    return `table:${headers}::${firstRow}`;
  }
  return `${block.type}:${JSON.stringify(block.content ?? null)}`;
}

export function getBlockIdentitySignature(block) {
  if (!block) return '';
  return `${block.type}:${JSON.stringify(block.content ?? null)}`;
}

export function reconcileLoadedBlockIds(prevBlocks, nextBlocks) {
  if (!prevBlocks?.length || !nextBlocks?.length) return nextBlocks;
  const idBuckets = new Map();

  prevBlocks.forEach((block) => {
    const signature = getBlockIdentitySignature(block);
    const bucket = idBuckets.get(signature) || [];
    bucket.push(block.id);
    idBuckets.set(signature, bucket);
  });

  return nextBlocks.map((block) => {
    const signature = getBlockIdentitySignature(block);
    const bucket = idBuckets.get(signature);
    if (!bucket?.length) return block;
    const reusedId = bucket.shift();
    return reusedId ? { ...block, id: reusedId } : block;
  });
}

export function captureViewportSnapshot(blocks, blockRefsMap, container) {
  if (!blocks?.length || !container) return null;
  const containerRect = container.getBoundingClientRect();
  let anchor = null;

  blocks.forEach((block, index) => {
    const node = blockRefsMap[block.id];
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) return;
    const candidate = {
      index,
      signature: getBlockScrollSignature(block),
      offsetTop: rect.top - containerRect.top,
      distance: Math.abs(rect.top - containerRect.top),
    };
    if (!anchor || candidate.distance < anchor.distance) {
      anchor = candidate;
    }
  });

  return {
    scrollTop: container.scrollTop,
    anchorIndex: anchor?.index ?? null,
    anchorSignature: anchor?.signature ?? '',
    anchorOffsetTop: anchor?.offsetTop ?? 0,
  };
}

export function restoreViewportSnapshot(snapshot, blocks, blockRefsMap, container) {
  if (!snapshot || !blocks?.length || !container) return false;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampScrollTop = (top) => Math.max(0, Math.min(top, maxScrollTop));
  const fallbackScrollTop = clampScrollTop(snapshot.scrollTop ?? 0);

  let targetIndex = -1;
  if (snapshot.anchorSignature) {
    const matches = [];
    blocks.forEach((block, index) => {
      if (getBlockScrollSignature(block) === snapshot.anchorSignature) matches.push(index);
    });
    if (matches.length) {
      targetIndex = matches[0];
      for (const currentIdx of matches) {
        if (Math.abs(currentIdx - (snapshot.anchorIndex ?? 0)) < Math.abs(targetIndex - (snapshot.anchorIndex ?? 0))) {
          targetIndex = currentIdx;
        }
      }
    }
  }
  if (targetIndex < 0 && snapshot.anchorIndex != null && blocks[snapshot.anchorIndex]) {
    targetIndex = snapshot.anchorIndex;
  }
  if (targetIndex < 0) {
    container.scrollTop = fallbackScrollTop;
    return false;
  }

  const targetBlock = blocks[targetIndex];
  const node = blockRefsMap[targetBlock.id];
  if (!node) {
    container.scrollTop = fallbackScrollTop;
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const desiredScrollTop = container.scrollTop + (nodeRect.top - containerRect.top) - (snapshot.anchorOffsetTop ?? 0);
  container.scrollTop = clampScrollTop(desiredScrollTop);
  return true;
}
