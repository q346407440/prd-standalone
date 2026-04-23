import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ElementRenderer } from './renderers/ElementRenderer.jsx';
import { getEnterCurrentMarkdown, getEnterNextMarkdown } from './renderers/element-renderer-utils.js';
import { ActionPanel } from './FloatingActionBubble.jsx';
import { BlockMoreMenu } from './BlockMoreMenu.jsx';
import {
  mermaidTableMetaKey,
  mindmapTableMetaKey,
  resolveMermaidViewMode,
  resolveMindmapViewMode,
} from '../prd-perf-keys.js';
import {
  ACTIONBAR_OPEN_DELAY_MS,
  ACTIONBAR_SWITCH_DELAY_MS,
  ACTIONBAR_CLOSE_DELAY_MS,
  ELEMENT_TYPE_LABELS,
} from '../prd-constants.js';
import {
  nodeContainsTarget,
  cloneSerializable,
  isGlobalSelectionOnTableCellElement,
  isForeignSelectionForTableCell,
} from '../prd-utils.js';
import {
  parseListPrefix,
  createTypedMarkdownListOptions,
  renumberOrderedGroupAt,
  renumberOrderedItemsFrom,
} from '../prd-list-utils.js';
import { getUsageRegions } from '../prd-annotations.js';

const getCellElementMd = (item) => item?.markdown || '';
const setCellElementMd = (item, markdown) => ({ ...item, markdown });
const getCellElementListType = (item) => (item?.type === 'text' ? item.type : null);

function renumberCellElements(elements, changedIdx) {
  const el = elements[changedIdx];
  if (!el || el.type !== 'text') return elements;
  return renumberOrderedGroupAt(elements, changedIdx, createTypedMarkdownListOptions({
    anchorItem: el,
    getMarkdown: getCellElementMd,
    setMarkdown: setCellElementMd,
    getItemType: getCellElementListType,
  }));
}

function renumberCellElementsFrom(elements, changedIdx, startNum) {
  const el = elements[changedIdx];
  if (!el || el.type !== 'text') return elements;
  const md = getCellElementMd(el);
  const parsed = parseListPrefix(md);
  if (!parsed) return elements;
  const opts = createTypedMarkdownListOptions({
    anchorItem: el,
    getMarkdown: getCellElementMd,
    setMarkdown: setCellElementMd,
    getItemType: getCellElementListType,
  });
  const result = renumberOrderedItemsFrom(elements, changedIdx, parsed.indent, startNum, opts);
  return result ?? elements;
}

function isOrderedCellTextElementAt(elements, idx) {
  const el = elements[idx];
  if (!el || el.type !== 'text') return false;
  const parsed = parseListPrefix(getCellElementMd(el));
  return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

function maybeRenumberCellElementsAt(elements, idx) {
  if (!isOrderedCellTextElementAt(elements, idx)) return elements;
  return renumberCellElements(elements, idx);
}

export function CellRenderer({
  cellElement,
  onUpdate,
  blockId,
  ri,
  ci,
  globalSelection,
  setGlobalSelection,
  rowBinding,
  annotationsDoc,
  onAnnotateUsage,
  hoverSuppressed = false,
  mermaidMeta,
  onMermaidMetaChange,
  mindmapMeta,
  onMindmapMetaChange,
  prdAssetCacheBust = 0,
  onCopyMdCursorRef,
  onActionBubbleHoverChange,
}) {
  const elements = useMemo(
    () => cellElement?.elements
      ?? (cellElement?.element ? [cellElement.element] : [{ type: 'text', markdown: '' }]),
    [cellElement],
  );

  const [focusIdx, setFocusIdx] = useState(null);
  const [activeElementActionIdx, setActiveElementActionIdx] = useState(null);
  const [showMoreMenuIdx, setShowMoreMenuIdx] = useState(null);
  const containerRefs = useRef({});
  const activeElementActionIdxRef = useRef(null);
  const hoveredElementActionIdxRef = useRef(null);
  const actionOpenTimerRef = useRef(null);
  const actionCloseTimerRef = useRef(null);
  const pendingActionIdxRef = useRef(null);
  const imageUsageByElementIdx = useMemo(() => {
    if (!rowBinding || ci !== rowBinding.designCi) return {};
    const map = {};
    let imageIdx = 0;
    elements.forEach((element, idx) => {
      if (element?.type !== 'image') return;
      const usage = rowBinding.usages?.find((item) => item.imageIndex === imageIdx);
      if (usage) map[idx] = usage;
      imageIdx += 1;
    });
    return map;
  }, [ci, elements, rowBinding]);

  useEffect(() => {
    if (focusIdx == null) return;
    const container = containerRefs.current[focusIdx];
    if (!container) return;
    const el = container.querySelector(
      'textarea, input, [contenteditable], .prd-editable-md--preview, .prd-image-renderer'
    );
    if (el) {
      el.click?.();
      el.focus?.();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- clear the one-shot focus request after the DOM target is focused
    setFocusIdx(null);
  }, [focusIdx, elements.length]);

  useEffect(() => {
    activeElementActionIdxRef.current = activeElementActionIdx;
  }, [activeElementActionIdx]);

  const clearPendingElementActionOpen = useCallback((idx = null) => {
    if (idx != null && pendingActionIdxRef.current !== idx) return;
    if (actionOpenTimerRef.current) clearTimeout(actionOpenTimerRef.current);
    actionOpenTimerRef.current = null;
    if (idx == null || pendingActionIdxRef.current === idx) {
      pendingActionIdxRef.current = null;
    }
  }, []);

  const clearPendingElementActionClose = useCallback(() => {
    if (actionCloseTimerRef.current) clearTimeout(actionCloseTimerRef.current);
    actionCloseTimerRef.current = null;
  }, []);

  const requestElementActionOpen = useCallback((idx, { immediate = false } = {}) => {
    if (hoverSuppressed || isForeignSelectionForTableCell(globalSelection, blockId, ri, ci)) return;
    clearPendingElementActionClose();
    const activeIdx = activeElementActionIdxRef.current;
    if (activeIdx === idx) {
      clearPendingElementActionOpen(idx);
      return;
    }
    const delay = immediate ? 0 : activeIdx != null ? ACTIONBAR_SWITCH_DELAY_MS : ACTIONBAR_OPEN_DELAY_MS;
    clearPendingElementActionOpen();
    pendingActionIdxRef.current = idx;
    const open = () => {
      if (pendingActionIdxRef.current !== idx) return;
      const fromSelection = isGlobalSelectionOnTableCellElement(globalSelection, blockId, ri, ci, idx);
      const fromHoverIntent = hoveredElementActionIdxRef.current === idx;
      if (!fromHoverIntent && !fromSelection) {
        pendingActionIdxRef.current = null;
        actionOpenTimerRef.current = null;
        return;
      }
      pendingActionIdxRef.current = null;
      actionOpenTimerRef.current = null;
      setActiveElementActionIdx(idx);
    };
    if (delay === 0) {
      open();
      return;
    }
    actionOpenTimerRef.current = setTimeout(open, delay);
  }, [blockId, ci, clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed, ri]);

  const requestElementActionClose = useCallback((idx, { immediate = false } = {}) => {
    clearPendingElementActionOpen(idx);
    clearPendingElementActionClose();
    const close = () => {
      actionCloseTimerRef.current = null;
      onActionBubbleHoverChange?.(false);
      setActiveElementActionIdx((curr) => (curr === idx ? null : curr));
    };
    if (immediate) {
      close();
      return;
    }
    actionCloseTimerRef.current = setTimeout(close, ACTIONBAR_CLOSE_DELAY_MS);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, onActionBubbleHoverChange]);

  const keepElementActionOpen = useCallback((idx) => {
    if (hoverSuppressed || isForeignSelectionForTableCell(globalSelection, blockId, ri, ci)) return;
    hoveredElementActionIdxRef.current = idx;
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    if (activeElementActionIdxRef.current !== idx) {
      setActiveElementActionIdx(idx);
    }
  }, [blockId, ci, clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed, ri]);

  useEffect(() => {
    if (activeElementActionIdx == null || hoverSuppressed) return undefined;
    const closeActiveAction = () => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      requestElementActionClose(idx, { immediate: true });
    };
    const handlePointerOutside = (event) => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      const t = event.target;
      const container = containerRefs.current[idx];
      if (nodeContainsTarget(container, t)) return;
      /* 保留對舊 portal DOM 的兼容；現行格內 actionbar 已改為貼在元素容器內 */
      if (t && typeof t.closest === 'function' && t.closest('.prd-floating-action-bubble')) return;
      closeActiveAction();
    };
    const handleWindowMouseOut = (event) => {
      if (event.relatedTarget == null) closeActiveAction();
    };
    document.addEventListener('mousemove', handlePointerOutside, true);
    document.addEventListener('mousedown', handlePointerOutside, true);
    window.addEventListener('blur', closeActiveAction);
    window.addEventListener('mouseout', handleWindowMouseOut);
    return () => {
      document.removeEventListener('mousemove', handlePointerOutside, true);
      document.removeEventListener('mousedown', handlePointerOutside, true);
      window.removeEventListener('blur', closeActiveAction);
      window.removeEventListener('mouseout', handleWindowMouseOut);
    };
  }, [activeElementActionIdx, globalSelection, hoverSuppressed, requestElementActionClose]);

  useEffect(() => () => {
    onActionBubbleHoverChange?.(false);
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, onActionBubbleHoverChange]);

  useEffect(() => {
    if (hoverSuppressed) {
      hoveredElementActionIdxRef.current = null;
      onActionBubbleHoverChange?.(false);
      clearPendingElementActionOpen();
      clearPendingElementActionClose();
      /* eslint-disable react-hooks/set-state-in-effect -- external hover suppression should synchronously collapse cell action UI */
      setActiveElementActionIdx(null);
      setShowMoreMenuIdx(null);
      /* eslint-enable react-hooks/set-state-in-effect */
      return;
    }
    if (globalSelection == null) return;
    if (isForeignSelectionForTableCell(globalSelection, blockId, ri, ci)) {
      hoveredElementActionIdxRef.current = null;
      onActionBubbleHoverChange?.(false);
      clearPendingElementActionOpen();
      clearPendingElementActionClose();
      setActiveElementActionIdx(null);
      setShowMoreMenuIdx(null);
    }
  }, [blockId, ci, clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed, onActionBubbleHoverChange, ri]);

  const updateElement = useCallback((idx, newEl) => {
    let next = elements.map((el, i) => i === idx ? newEl : el);
    next = renumberCellElements(next, idx);
    onUpdate({ elements: next });
  }, [elements, onUpdate]);

  const insertElementAfter = useCallback((idx, newEl) => {
    const next = [
      ...elements.slice(0, idx + 1),
      newEl,
      ...elements.slice(idx + 1),
    ];
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const insertElementBefore = useCallback((idx, newEl) => {
    const next = [
      ...elements.slice(0, idx),
      newEl,
      ...elements.slice(idx),
    ];
    onUpdate({ elements: next });
    setFocusIdx(idx);
  }, [elements, onUpdate]);

  const duplicateElementAfter = useCallback((idx) => {
    const duplicated = cloneSerializable(elements[idx]);
    let next = [
      ...elements.slice(0, idx + 1),
      duplicated,
      ...elements.slice(idx + 1),
    ];
    next = maybeRenumberCellElementsAt(next, idx + 1);
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const addElementAfter = useCallback((idx, enterPayload) => {
    const currentMarkdown = getEnterCurrentMarkdown(enterPayload);
    const nextMarkdown = getEnterNextMarkdown(enterPayload);
    const updatedCurrent = currentMarkdown !== undefined
      ? { ...elements[idx], type: 'text', markdown: currentMarkdown }
      : elements[idx];
    let next = [
      ...elements.slice(0, idx),
      updatedCurrent,
      { type: 'text', markdown: nextMarkdown },
      ...elements.slice(idx + 1),
    ];
    next = renumberCellElements(next, idx + 1);
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const removeElement = useCallback((idx) => {
    if (elements.length <= 1) {
      onUpdate({ elements: [{ type: 'text', markdown: '' }] });
      return;
    }
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    let next = elements.filter((_, i) => i !== idx);
    const neighborIdx = Math.min(idx, next.length - 1);
    if (neighborIdx >= 0) next = maybeRenumberCellElementsAt(next, neighborIdx);
    onUpdate({ elements: next });
    /* 不自動聚焦上一段（與主文刪除 block 行為一致） */
    if (setGlobalSelection && globalSelection?.blockId === blockId && globalSelection.cellPath != null
      && globalSelection.cellPath.ri === ri && globalSelection.cellPath.ci === ci) {
      const eidx = globalSelection.cellPath.idx;
      if (eidx === idx) {
        setGlobalSelection(null);
      } else if (eidx > idx) {
        setGlobalSelection({
          ...globalSelection,
          cellPath: { ...globalSelection.cellPath, idx: eidx - 1 },
        });
      }
    }
    setActiveElementActionIdx((curr) => {
      if (curr == null) return null;
      if (curr === idx) return null;
      if (curr > idx) return curr - 1;
      return curr;
    });
    setShowMoreMenuIdx((curr) => {
      if (curr == null) return null;
      if (curr === idx) return null;
      if (curr > idx) return curr - 1;
      return curr;
    });
    setTimeout(() => {
      const ae = document.activeElement;
      if (ae instanceof HTMLElement && ae !== document.body) ae.blur();
    }, 0);
  }, [
    blockId,
    ci,
    clearPendingElementActionClose,
    clearPendingElementActionOpen,
    elements,
    globalSelection,
    onUpdate,
    ri,
    setGlobalSelection,
  ]);

  const mergeWithPrevElement = useCallback((idx, currentMd) => {
    if (idx <= 0) return;
    const prevEl = elements[idx - 1];
    if (!prevEl || prevEl.type !== 'text') return;
    const prevMd = prevEl.markdown || '';
    const merged = prevMd ? prevMd + currentMd : currentMd;
    const next = elements
      .map((el, i) => (i === idx - 1 ? { ...el, markdown: merged } : el))
      .filter((_, i) => i !== idx);
    onUpdate({ elements: next });
    setFocusIdx(idx - 1);
  }, [elements, onUpdate]);

  const moveElement = useCallback((idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= elements.length) return;
    const next = [...elements];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    onUpdate({
      elements: maybeRenumberCellElementsAt(maybeRenumberCellElementsAt(next, idx), targetIdx),
    });
    setFocusIdx(targetIdx);
    if (elements[idx]?.type === 'image') {
      setGlobalSelection?.({ type: 'image', blockId, cellPath: { ri, ci, idx: targetIdx } });
    } else if (elements[idx]?.type === 'mermaid' || elements[idx]?.type === 'mindmap') {
      setGlobalSelection?.({ type: 'diagram', blockId, cellPath: { ri, ci, idx: targetIdx } });
    }
  }, [elements, onUpdate, setGlobalSelection, blockId, ri, ci]);

  const [elementInsertMenu, setElementInsertMenu] = useState(null);

  const handleElementInsert = useCallback((idx, direction, elType) => {
    let newEl;
    if (elType === 'mermaid') newEl = { type: 'mermaid', code: '' };
    else if (elType === 'mindmap') newEl = { type: 'mindmap', code: '' };
    else if (elType === 'image') newEl = { type: 'image', src: '' };
    else newEl = { type: 'text', markdown: '' };
    if (direction === 'above') {
      insertElementBefore(idx, newEl);
    } else {
      insertElementAfter(idx, newEl);
    }
    setElementInsertMenu(null);
  }, [insertElementAfter, insertElementBefore]);

  return (
    <div className="prd-cell-renderer">
      {elements.map((element, idx) => {
        const barFromCellSelection = isGlobalSelectionOnTableCellElement(
          globalSelection, blockId, ri, ci, idx,
        );
        const isTextPreviewSelected = globalSelection?.type === 'text-block'
          && globalSelection.blockId === blockId
          && globalSelection.cellPath?.ri === ri
          && globalSelection.cellPath?.ci === ci
          && globalSelection.cellPath?.idx === idx;
        const isImageSelected = globalSelection?.type === 'image'
          && globalSelection.blockId === blockId
          && globalSelection.cellPath?.ri === ri
          && globalSelection.cellPath?.ci === ci
          && globalSelection.cellPath?.idx === idx;
        const isDiagramSelected = globalSelection?.type === 'diagram'
          && globalSelection.blockId === blockId
          && globalSelection.cellPath?.ri === ri
          && globalSelection.cellPath?.ci === ci
          && globalSelection.cellPath?.idx === idx;
        return (
        <div
          className={[
            'prd-cell-element',
            (activeElementActionIdx === idx || barFromCellSelection) ? 'prd-cell-element--action-active' : '',
          ].filter(Boolean).join(' ')}
          key={idx}
          ref={(el) => {
            if (el) containerRefs.current[idx] = el;
            else delete containerRefs.current[idx];
          }}
          onMouseEnter={() => {
            if (element.type === 'text' || !element.type) return;
            /* 圖片僅在點擊選中後顯示格內操作條，hover 不觸發（與 ImageRenderer 選中態一致） */
            if (element.type === 'image' || element.type === 'mermaid' || element.type === 'mindmap') return;
            hoveredElementActionIdxRef.current = idx;
            requestElementActionOpen(idx);
          }}
          onMouseLeave={() => {
            if (hoveredElementActionIdxRef.current === idx) hoveredElementActionIdxRef.current = null;
            if (barFromCellSelection) return;
            requestElementActionClose(idx);
          }}
        >
          <ActionPanel
            visible={
              !hoverSuppressed
              && (
                barFromCellSelection
                || (
                  activeElementActionIdx === idx
                  && !isForeignSelectionForTableCell(globalSelection, blockId, ri, ci)
                )
              )
            }
            className="prd-cell-element__actions"
            onMouseEnter={() => {
              onActionBubbleHoverChange?.(true);
              keepElementActionOpen(idx);
            }}
            onMouseLeave={() => {
              onActionBubbleHoverChange?.(false);
              if (hoveredElementActionIdxRef.current === idx) hoveredElementActionIdxRef.current = null;
              if (barFromCellSelection) return;
              if (showMoreMenuIdx === idx) return;
              if (elementInsertMenu?.idx === idx) return;
              requestElementActionClose(idx);
            }}
          >
            {onCopyMdCursorRef ? (
              <button
                type="button"
                className="prd-action-btn prd-cell-element__action-btn prd-action-btn--primary"
                title="复制 @文件:行号，供粘贴到 Cursor"
                onClick={() => onCopyMdCursorRef({ blockId, cellPath: { ri, ci, idx } })}
              >
                复制 MD 行号
              </button>
            ) : null}
            <button
              type="button"
              className="prd-action-btn prd-action-btn--danger prd-cell-element__action-btn"
              title="删除"
              onClick={() => removeElement(idx)}
            >
              删除
            </button>
            <div
              className="prd-cell-element__more"
              onMouseEnter={() => {
                setShowMoreMenuIdx(idx);
                setElementInsertMenu(null);
              }}
              onMouseLeave={() => {
                setShowMoreMenuIdx((curr) => (curr === idx ? null : curr));
              }}
            >
              <button
                type="button"
                className={[
                  'prd-action-btn',
                  'prd-cell-element__action-btn',
                  'prd-action-btn--icon-text',
                  showMoreMenuIdx === idx ? 'prd-action-btn--active' : '',
                ].filter(Boolean).join(' ')}
                title="更多操作"
                aria-haspopup="menu"
                aria-expanded={showMoreMenuIdx === idx}
                onFocus={() => {
                  setShowMoreMenuIdx(idx);
                  setElementInsertMenu(null);
                }}
                onClick={() => {
                  setShowMoreMenuIdx((prev) => (prev === idx ? null : idx));
                  setElementInsertMenu(null);
                }}
              >
                更多
                <span className="prd-action-btn__caret" aria-hidden="true">▾</span>
              </button>
              {showMoreMenuIdx === idx && (
                <BlockMoreMenu
                  position="below"
                  onClose={() => setShowMoreMenuIdx(null)}
                  items={[
                    {
                      id: 'duplicate',
                      label: '复制当前',
                      onClick: () => duplicateElementAfter(idx),
                    },
                    {
                      id: 'insert-above',
                      label: '上方插入…',
                      onClick: () => setElementInsertMenu({ idx, direction: 'above' }),
                    },
                    {
                      id: 'insert-below',
                      label: '下方插入…',
                      onClick: () => setElementInsertMenu({ idx, direction: 'below' }),
                    },
                    {
                      id: 'move-up',
                      label: '上移',
                      disabled: idx <= 0,
                      onClick: () => moveElement(idx, -1),
                    },
                    {
                      id: 'move-down',
                      label: '下移',
                      disabled: idx >= elements.length - 1,
                      onClick: () => moveElement(idx, 1),
                    },
                  ]}
                />
              )}
            </div>
            {elementInsertMenu?.idx === idx && (
              <CellElementInsertMenu
                direction={elementInsertMenu.direction}
                onSelect={(elType) => handleElementInsert(idx, elementInsertMenu.direction, elType)}
                onClose={() => setElementInsertMenu(null)}
              />
            )}
          </ActionPanel>
          <ElementRenderer
            element={element}
            onUpdate={(newEl) => updateElement(idx, newEl)}
            onDelete={() => removeElement(idx)}
            blockId={blockId}
            cellPath={{ ri, ci, idx }}
            isPreviewSelected={isTextPreviewSelected}
            isImageSelected={isImageSelected}
            isDiagramSelected={isDiagramSelected}
            setGlobalSelection={setGlobalSelection}
            onEnter={(currentMd) => addElementAfter(idx, currentMd)}
            onBackspaceEmpty={() => {
              if (elements.length > 1) removeElement(idx);
            }}
            onBackspaceMerge={idx > 0 ? (currentMd) => mergeWithPrevElement(idx, currentMd) : undefined}
            onPasteImageAsBlock={(src) => insertElementAfter(idx, { type: 'image', src })}
            onReplaceWithImage={(src) => updateElement(idx, { type: 'image', src })}
            placeholder={idx === 0 ? '—' : ''}
            onAnnotate={
              imageUsageByElementIdx[idx] && onAnnotateUsage
                ? () => onAnnotateUsage(imageUsageByElementIdx[idx])
                : undefined
            }
            annotationCount={
              onAnnotateUsage && imageUsageByElementIdx[idx]
                ? getUsageRegions(annotationsDoc, imageUsageByElementIdx[idx].usageId).length
                : 0
            }
            onResetOrderedStart={(newMd, startNum) => {
              let next = elements.map((el, i) => i === idx ? { ...el, markdown: newMd } : el);
              next = renumberCellElementsFrom(next, idx, startNum);
              onUpdate({ elements: next });
            }}
            mermaidViewMode={element.type === 'mermaid'
              ? resolveMermaidViewMode(mermaidMeta, element.code, {
                kind: 'table', blockId, ri, ci, idx,
              })
              : undefined}
            onMermaidViewModeChange={element.type === 'mermaid' ? (mode) => {
              onMermaidMetaChange?.('mermaidViewModes', mermaidTableMetaKey(blockId, ri, ci, idx), mode);
            } : undefined}
            mindmapViewMode={element.type === 'mindmap'
              ? resolveMindmapViewMode(mindmapMeta, element.code, {
                kind: 'table', blockId, ri, ci, idx,
              })
              : undefined}
            onMindmapViewModeChange={element.type === 'mindmap' ? (mode) => {
              onMindmapMetaChange?.('mindmapViewModes', mindmapTableMetaKey(blockId, ri, ci, idx), mode);
            } : undefined}
            onDiagramSelect={element.type === 'mermaid' || element.type === 'mindmap' ? () => {
              setGlobalSelection?.({ type: 'diagram', blockId, cellPath: { ri, ci, idx } });
              clearPendingElementActionOpen();
              clearPendingElementActionClose();
              setActiveElementActionIdx(idx);
            } : undefined}
            prdAssetCacheBust={prdAssetCacheBust}
          />
        </div>
        );
      })}
    </div>
  );
}

export function CellElementInsertMenu({ direction, onSelect, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [onClose]);

  return (
    <div
      ref={menuRef}
      className={`prd-cell-element__insert-menu prd-cell-element__insert-menu--${direction} prd-cell-element__insert-menu--standalone`}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {Object.entries(ELEMENT_TYPE_LABELS).map(([elType, elLabel]) => (
        <button
          key={elType}
          type="button"
          className="prd-cell-element__insert-menu-item"
          onClick={() => {
            onSelect(elType);
            onClose();
          }}
        >
          {elLabel}
        </button>
      ))}
    </div>
  );
}
