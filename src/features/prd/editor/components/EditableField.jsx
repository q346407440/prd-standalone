import { useCallback, useEffect, useRef, useState } from 'react';
import {
  HEADING_BLOCK_TYPE_SET,
  BLOCK_LEVEL_OPTIONS,
} from '../prd-constants.js';
import {
  parseListPrefix,
  hasListPrefix,
  hasIndent,
  indentMarkdown,
  dedentMarkdown,
  adjustOrderedMarkerAfterIndent,
  isBareListPrefixMd,
  switchMarkdownListKind,
} from '../prd-list-utils.js';
import {
  wrapSelectionWithBold,
  getTextOffsetFromPoint,
  getShortcutBlockLevel,
  matchesShiftDigitShortcut,
} from '../prd-text-editing.js';
import {
  uploadPastedImage,
  getImageFromPaste,
} from '../prd-api.js';
import { FloatingActionBubble } from './FloatingActionBubble.jsx';

export function EditableField({
  value,
  onSave,
  placeholder = '点击编辑…',
  className = '',
  blockId,
  selectionRole,
  globalSelection,
  setGlobalSelection,
  onEnter,
  onBackspaceEmpty,
  onEditingFinished,
  /** 當前 block 層級（h1–h7/paragraph），用於標題浮窗；未傳則不顯示層級按鈕 */
  blockLevel,
  onBlockLevelChange,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  const previewRef = useRef(null);
  const pendingCaretOffsetRef = useRef(null);
  const selRef = useRef({ start: 0, end: 0 });
  const [showSelToolbar, setShowSelToolbar] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const caret = pendingCaretOffsetRef.current;
    if (typeof caret === 'number') {
      const safeCaret = Math.max(0, Math.min(caret, ref.current.value.length));
      ref.current.setSelectionRange(safeCaret, safeCaret);
      selRef.current = { start: safeCaret, end: safeCaret };
      pendingCaretOffsetRef.current = null;
    }
  }, [editing]);

  const syncSelection = useCallback(() => {
    const el = ref.current;
    if (!el || typeof el.selectionStart !== 'number') return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    selRef.current = { start: a, end: b };
    setShowSelToolbar(a !== b);
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    setShowSelToolbar(false);
    if (draft !== value) onSave(draft);
    onEditingFinished?.();
  }, [draft, value, onSave, onEditingFinished]);

  const applyBold = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { start, end } = selRef.current;
    const r = wrapSelectionWithBold(draft, start, end);
    if (!r) return;
    setDraft(r.next);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.setSelectionRange(r.selStart, r.selEnd);
        selRef.current = { start: r.selStart, end: r.selEnd };
        ref.current.focus();
      }
    });
  }, [draft]);

  const applyBlockLevel = useCallback((nextType) => {
    if (!onBlockLevelChange || nextType === blockLevel) return;
    onBlockLevelChange(nextType, draft);
  }, [onBlockLevelChange, blockLevel, draft]);

  const updateDraftAndKeepFocus = useCallback((nextDraft) => {
    setDraft(nextDraft);
    setShowSelToolbar(false);
    onSave(nextDraft);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const pos = nextDraft.length;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
      selRef.current = { start: pos, end: pos };
    });
  }, [onSave]);

  const onKeyDown = useCallback((e) => {
    const parsed = parseListPrefix(draft);
    const shortcutLevel = getShortcutBlockLevel(e);

    if (e.key === ' ' && !parsed && ref.current) {
      const cursorPos = ref.current.selectionStart;
      const candidate = draft.slice(0, cursorPos);
      const listTrigger = candidate.match(/^(\d+\.|[a-z]+\.|[-*+])$/);
      if (listTrigger) {
        e.preventDefault();
        const newPrefix = listTrigger[0] + ' ';
        const rest = draft.slice(cursorPos);
        updateDraftAndKeepFocus(newPrefix + rest);
        return;
      }
    }

    if (shortcutLevel && onBlockLevelChange) {
      e.preventDefault();
      applyBlockLevel(shortcutLevel);
      return;
    }

    if (matchesShiftDigitShortcut(e, 8)) {
      e.preventDefault();
      updateDraftAndKeepFocus(
        parsed && /^[-*+]$/.test(parsed.marker)
          ? switchMarkdownListKind(draft, 'off')
          : switchMarkdownListKind(draft, 'bullet'),
      );
      return;
    }

    if (matchesShiftDigitShortcut(e, 7)) {
      e.preventDefault();
      updateDraftAndKeepFocus(
        parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker)
          ? switchMarkdownListKind(draft, 'off')
          : switchMarkdownListKind(draft, 'ordered'),
      );
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!hasListPrefix(draft)) return;
      if (e.shiftKey) {
        if (!hasIndent(draft)) return;
        updateDraftAndKeepFocus(adjustOrderedMarkerAfterIndent(dedentMarkdown(draft)));
      } else {
        updateDraftAndKeepFocus(adjustOrderedMarkerAfterIndent(indentMarkdown(draft)));
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
      onEnter?.(draft);
      return;
    }
    if (e.key === 'Backspace' && onBackspaceEmpty && draft === '') {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if (e.key === 'Backspace' && isBareListPrefixMd(draft)) {
      const input = ref.current;
      const cursorAtEnd = input
        && input.selectionStart === input.selectionEnd
        && input.selectionEnd === draft.length;
      if (cursorAtEnd) {
        e.preventDefault();
        updateDraftAndKeepFocus('');
        return;
      }
    }
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
      setShowSelToolbar(false);
      onEditingFinished?.();
    }
  }, [
    applyBlockLevel,
    blockLevel,
    onBlockLevelChange,
    commit,
    value,
    draft,
    onEnter,
    onBackspaceEmpty,
    onEditingFinished,
    updateDraftAndKeepFocus,
  ]);

  const textLineSelected =
    blockId && selectionRole && globalSelection?.type === 'text-block'
    && globalSelection.blockId === blockId && globalSelection.role === selectionRole;

  const onPasteImage = useCallback(async (e) => {
    const file = getImageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    try {
      const imagePath = await uploadPastedImage(file);
      const insert = `![粘贴图片](${imagePath})`;
      const el = ref.current;
      const start = typeof el?.selectionStart === 'number' ? el.selectionStart : draft.length;
      const end = typeof el?.selectionEnd === 'number' ? el.selectionEnd : draft.length;
      const next = draft.slice(0, start) + insert + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        if (ref.current) {
          const pos = start + insert.length;
          ref.current.setSelectionRange(pos, pos);
        }
      });
    } catch (err) {
      console.error('图片上传失败', err);
    }
  }, [draft]);

  const showBoldToolbar = blockLevel == null || !HEADING_BLOCK_TYPE_SET.has(blockLevel);
  const hasLevelSwitcher = blockLevel != null && onBlockLevelChange;
  const bubbleVisible = showSelToolbar || hasLevelSwitcher;

  if (editing) {
    return (
      <span className="prd-editable-field-edit-wrap">
        <FloatingActionBubble
          visible={bubbleVisible}
          preferredVertical="above"
          preferredHorizontal="left"
          anchorRef={ref}
        >
          {showSelToolbar && showBoldToolbar && (
            <button
              type="button"
              className="prd-action-btn prd-action-btn--bold"
              title="粗体（插入 **）"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyBold}
            >
              B
            </button>
          )}
          {hasLevelSwitcher && (
            <label className="prd-action-select-wrap" title="标题层级">
              <select
                className="prd-action-select"
                value={blockLevel}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => applyBlockLevel(e.target.value)}
              >
                {BLOCK_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </FloatingActionBubble>
        <input
          ref={ref}
          className={`prd-editable prd-editable--input ${className}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onPaste={onPasteImage}
          onMouseUp={syncSelection}
          onKeyUp={syncSelection}
          onSelect={syncSelection}
        />
      </span>
    );
  }
  return (
    <span
      className={[
        'prd-editable prd-editable--view',
        textLineSelected ? 'prd-editable--text-selected' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-prd-no-block-select
      ref={previewRef}
      onMouseDown={(e) => {
        if (!setGlobalSelection || !blockId || !selectionRole) return;
        setGlobalSelection({ type: 'text-block', blockId, role: selectionRole });
        pendingCaretOffsetRef.current = getTextOffsetFromPoint(previewRef.current, e.clientX, e.clientY);
        e.stopPropagation();
      }}
      onClick={() => setEditing(true)}
    >
      {value || <span className="prd-editable__placeholder">{placeholder}</span>}
    </span>
  );
}
