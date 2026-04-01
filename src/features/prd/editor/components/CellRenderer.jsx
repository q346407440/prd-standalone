import { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { ElementRenderer, getEnterCurrentMarkdown, getEnterNextMarkdown } from './renderers/ElementRenderer.jsx';
import { ActionPanel } from './FloatingActionBubble.jsx';
import { mermaidCodeToMetaKey, mindmapCodeToMetaKey } from '../prd-perf-keys.js';
import {
  ACTIONBAR_OPEN_DELAY_MS,
  ACTIONBAR_SWITCH_DELAY_MS,
  ACTIONBAR_CLOSE_DELAY_MS,
  ELEMENT_TYPE_LABELS,
} from '../prd-constants.js';
import { isNodeHovered, nodeContainsTarget, cloneSerializable } from '../prd-utils.js';
import {
  parseListPrefix,
  createTypedMarkdownListOptions,
  renumberOrderedGroupAt,
  renumberOrderedItemsFrom,
  inferListPrefix,
} from '../prd-list-utils.js';
import { getUsageRegions } from '../prd-annotations.js';

const getCellElementMd = (item) => item?.markdown || '';
const setCellElementMd = (item, markdown) => ({ ...item, markdown });
const getCellElementListType = (item) => (item?.type === 'text' ? item.type : null);

export function renumberCellElements(elements, changedIdx) {
  const el = elements[changedIdx];
  if (!el || el.type !== 'text') return elements;
  return renumberOrderedGroupAt(elements, changedIdx, createTypedMarkdownListOptions({
    anchorItem: el,
    getMarkdown: getCellElementMd,
    setMarkdown: setCellElementMd,
    getItemType: getCellElementListType,
  }));
}

export function renumberCellElementsFrom(elements, changedIdx, startNum) {
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

export function isOrderedCellTextElementAt(elements, idx) {
  const el = elements[idx];
  if (!el || el.type !== 'text') return false;
  const parsed = parseListPrefix(getCellElementMd(el));
  return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

export function maybeRenumberCellElementsAt(elements, idx) {
  if (!isOrderedCellTextElementAt(elements, idx)) return elements;
  return renumberCellElements(elements, idx);
}

export function getCellElementMdHelper(item) {
  return getCellElementMd(item);
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
}) {
  const elements = useMemo(
    () => cellElement?.elements
      ?? (cellElement?.element ? [cellElement.element] : [{ type: 'text', markdown: '' }]),
    [cellElement],
  );

  const [focusIdx, setFocusIdx] = useState(null);
  const [activeElementActionIdx, setActiveElementActionIdx] = useState(null);
  const containerRefs = useRef({});
  const activeElementActionIdxRef = useRef(null);
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
    if (globalSelection != null || hoverSuppressed) return;
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
      const container = containerRefs.current[idx];
      if (!isNodeHovered(container)) {
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
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

  const requestElementActionClose = useCallback((idx, { immediate = false } = {}) => {
    clearPendingElementActionOpen(idx);
    clearPendingElementActionClose();
    const close = () => {
      actionCloseTimerRef.current = null;
      setActiveElementActionIdx((curr) => (curr === idx ? null : curr));
    };
    if (immediate) {
      close();
      return;
    }
    actionCloseTimerRef.current = setTimeout(close, ACTIONBAR_CLOSE_DELAY_MS);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen]);

  const keepElementActionOpen = useCallback((idx) => {
    if (globalSelection != null || hoverSuppressed) return;
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    if (activeElementActionIdxRef.current !== idx) {
      setActiveElementActionIdx(idx);
    }
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

  useEffect(() => {
    if (activeElementActionIdx == null || globalSelection != null || hoverSuppressed) return undefined;
    const closeActiveAction = () => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      requestElementActionClose(idx, { immediate: true });
    };
    const handlePointerOutside = (event) => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      const container = containerRefs.current[idx];
      if (nodeContainsTarget(container, event.target)) return;
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
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
  }, [clearPendingElementActionClose, clearPendingElementActionOpen]);

  useEffect(() => {
    if (globalSelection == null && !hoverSuppressed) return;
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    setActiveElementActionIdx(null);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

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
    let next = elements.filter((_, i) => i !== idx);
    const neighborIdx = Math.min(idx, next.length - 1);
    if (neighborIdx >= 0) next = maybeRenumberCellElementsAt(next, neighborIdx);
    onUpdate({ elements: next });
    setFocusIdx(Math.max(0, idx - 1));
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

  const getMermaidMetaKey = useCallback((idx) => {
    const el = elements[idx];
    return mermaidCodeToMetaKey(el?.code || '');
  }, [elements]);

  const getMindmapMetaKey = useCallback((idx) => {
    const el = elements[idx];
    return mindmapCodeToMetaKey(el?.code || '');
  }, [elements]);

  return (
    <div className="prd-cell-renderer">
      {elements.map((element, idx) => (
        <div
          className={[
            'prd-cell-element',
            activeElementActionIdx === idx ? 'prd-cell-element--action-active' : '',
          ].filter(Boolean).join(' ')}
          key={idx}
          ref={(el) => {
            if (el) containerRefs.current[idx] = el;
            else delete containerRefs.current[idx];
          }}
          onMouseEnter={() => requestElementActionOpen(idx)}
          onMouseLeave={() => requestElementActionClose(idx)}
        >
          <ActionPanel
            visible={globalSelection == null && activeElementActionIdx === idx}
            className="prd-cell-element__actions"
            onMouseEnter={() => keepElementActionOpen(idx)}
            onMouseLeave={() => requestElementActionClose(idx)}
          >
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              title="复制"
              onClick={() => duplicateElementAfter(idx)}
            >
              复制
            </button>
            <CellElementInsertButton
              label="上方插入"
              direction="above"
              idx={idx}
              isOpen={elementInsertMenu?.idx === idx && elementInsertMenu?.direction === 'above'}
              onToggle={() => setElementInsertMenu((prev) =>
                prev?.idx === idx && prev?.direction === 'above' ? null : { idx, direction: 'above' }
              )}
              onSelect={(elType) => handleElementInsert(idx, 'above', elType)}
              onClose={() => setElementInsertMenu(null)}
            />
            <CellElementInsertButton
              label="下方插入"
              direction="below"
              idx={idx}
              isOpen={elementInsertMenu?.idx === idx && elementInsertMenu?.direction === 'below'}
              onToggle={() => setElementInsertMenu((prev) =>
                prev?.idx === idx && prev?.direction === 'below' ? null : { idx, direction: 'below' }
              )}
              onSelect={(elType) => handleElementInsert(idx, 'below', elType)}
              onClose={() => setElementInsertMenu(null)}
            />
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              disabled={idx <= 0}
              title="上移"
              onClick={() => moveElement(idx, -1)}
            >
              上移
            </button>
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              disabled={idx >= elements.length - 1}
              title="下移"
              onClick={() => moveElement(idx, 1)}
            >
              下移
            </button>
            <button
              type="button"
              className="prd-action-btn prd-action-btn--danger prd-cell-element__action-btn"
              title="删除"
              onClick={() => removeElement(idx)}
            >
              删除
            </button>
          </ActionPanel>
          <ElementRenderer
            element={element}
            onUpdate={(newEl) => updateElement(idx, newEl)}
            onDelete={() => removeElement(idx)}
            onMoveUp={() => moveElement(idx, -1)}
            onMoveDown={() => moveElement(idx, 1)}
            canMoveUp={idx > 0}
            canMoveDown={idx < elements.length - 1}
            blockId={blockId}
            cellPath={{ ri, ci, idx }}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={(currentMd) => addElementAfter(idx, currentMd)}
            onBackspaceEmpty={() => {
              if (elements.length > 1) removeElement(idx);
            }}
            onPasteImageAsBlock={(src) => insertElementAfter(idx, { type: 'image', src })}
            onReplaceWithImage={(src) => updateElement(idx, { type: 'image', src })}
            placeholder={idx === 0 ? '—' : ''}
            onAnnotate={imageUsageByElementIdx[idx] ? () => onAnnotateUsage?.(imageUsageByElementIdx[idx]) : undefined}
            annotationCount={imageUsageByElementIdx[idx]
              ? getUsageRegions(annotationsDoc, imageUsageByElementIdx[idx].usageId).length
              : 0}
            onResetOrderedStart={(newMd, startNum) => {
              let next = elements.map((el, i) => i === idx ? { ...el, markdown: newMd } : el);
              next = renumberCellElementsFrom(next, idx, startNum);
              onUpdate({ elements: next });
            }}
            mermaidViewMode={element.type === 'mermaid' ? (mermaidMeta?.mermaidViewModes?.[getMermaidMetaKey(idx)] || 'code') : undefined}
            onMermaidViewModeChange={element.type === 'mermaid' ? (mode) => {
              const key = getMermaidMetaKey(idx);
              onMermaidMetaChange?.('mermaidViewModes', key, mode);
            } : undefined}
            mindmapViewMode={element.type === 'mindmap' ? (mindmapMeta?.mindmapViewModes?.[getMindmapMetaKey(idx)] || 'code') : undefined}
            onMindmapViewModeChange={element.type === 'mindmap' ? (mode) => {
              const key = getMindmapMetaKey(idx);
              onMindmapMetaChange?.('mindmapViewModes', key, mode);
            } : undefined}
          />
        </div>
      ))}
    </div>
  );
}

export function CellElementInsertButton({ label, direction, idx, isOpen, onToggle, onSelect, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen, onClose]);

  return (
    <div className="prd-cell-element__insert-wrap" ref={menuRef}>
      <button
        type="button"
        className={`prd-action-btn prd-cell-element__action-btn${isOpen ? ' prd-action-btn--active' : ''}`}
        title={label}
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen && (
        <div className={`prd-cell-element__insert-menu prd-cell-element__insert-menu--${direction}`}>
          {Object.entries(ELEMENT_TYPE_LABELS).map(([elType, elLabel]) => (
            <button
              key={elType}
              type="button"
              className="prd-cell-element__insert-menu-item"
              onClick={() => onSelect(elType)}
            >
              {elLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
