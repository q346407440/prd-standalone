import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import HardBreak from '@tiptap/extension-hard-break';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import { editorToMarkdown } from './tiptap-md-utils.js';
import { getTextOffsetFromPoint } from './prd-text-editing.js';
import { emitPrdToast } from './prd-toast.js';
import { renderParagraphMarkdownPreviewToHtml } from './tiptap-markdown-preview.js';
import { SelectionToolbar, ListPrefixMenu } from './tiptap-editing-toolbar.jsx';
import {
  adjustOrderedMarkerAfterIndent,
  applyListPrefix,
  dedentMarkdown,
  hasIndent,
  hasListPrefix,
  indentMarkdown,
  inferListPrefix,
  numToAlphaMarker,
  mergeListPrefixWithParagraphMarkdown,
  parseListPrefix,
  switchMarkdownListKind,
} from './prd-list-utils.js';

function getShortcutBlockLevel(e) {
  if (!(e.altKey && (e.metaKey || e.ctrlKey))) return null;
  if (e.key === '0') return 'paragraph';
  if (/^[1-7]$/.test(e.key)) return `h${e.key}`;
  return null;
}

function matchesShiftDigitShortcut(e, digit) {
  return e.shiftKey
    && (e.metaKey || e.ctrlKey)
    && (e.code === `Digit${digit}` || e.key === String(digit));
}

// ─── 通用工具 ──────────────────────────────────────────────────────────────

function isRootSingleEmptyParagraph(doc) {
  if (!doc || doc.childCount !== 1) return false;
  const first = doc.firstChild;
  return first.type.name === 'paragraph' && first.content.size === 0;
}

function trimTrailingEmptyLines(md) {
  return md.replace(/\n+$/, '');
}

function getProseMirrorPosFromTextOffset(doc, textOffset) {
  const safeOffset = Math.max(0, textOffset ?? 0);
  let remaining = safeOffset;
  let foundPos = 1;
  let matched = false;
  doc.descendants((node, pos) => {
    if (!node.isText) return true;
    const textLength = node.text?.length ?? 0;
    if (remaining <= textLength) {
      foundPos = pos + remaining;
      matched = true;
      return false;
    }
    remaining -= textLength;
    foundPos = pos + textLength;
    return true;
  });
  return matched ? foundPos : 1;
}

function getListTriggerCandidate(editor) {
  if (!editor) return '';
  const rawText = trimTrailingEmptyLines(editor.state.doc.textContent || '').trim();
  if (rawText) return rawText;
  const markdownText = trimTrailingEmptyLines(editorToMarkdown(editor) || '').trim();
  return markdownText.replace(/^\\([-*+])$/, '$1');
}

/**
 * 將段落內 Fragment 序列化為 Markdown。
 * 必須包成一層 doc → paragraph 再交給 serializer：若直接 serialize(fragment)，
 * tiptap-markdown 會對子節點走 nodes.text，不經 renderInline，導致粗體/斜體等 mark 丟失。
 */
function serializeMarkdownFragment(editor, fragment) {
  const serializer = editor?.storage?.markdown?.serializer;
  if (!serializer || !editor?.schema) return '';
  if (!fragment || fragment.size === 0) return '';
  const paragraph = editor.schema.nodes.paragraph.create(null, fragment);
  const doc = editor.schema.topNodeType.create({}, paragraph);
  return trimTrailingEmptyLines(serializer.serialize(doc));
}

function buildEnterPayload(editor, prefix) {
  const inlineMd = trimTrailingEmptyLines(editorToMarkdown(editor));
  const currentMarkdownFallback = mergeListPrefixWithParagraphMarkdown(inlineMd, prefix);

  if (!editor?.state?.selection) {
    const inheritedPrefix = inferListPrefix(currentMarkdownFallback);
    return inheritedPrefix
      ? { currentMarkdown: currentMarkdownFallback, nextMarkdown: inheritedPrefix }
      : { currentMarkdown: currentMarkdownFallback };
  }

  const { selection } = editor.state;
  const { $from, $to } = selection;

  if ($from.parent !== $to.parent || !$from.parent.isTextblock) {
    const inheritedPrefix = inferListPrefix(currentMarkdownFallback);
    return inheritedPrefix
      ? { currentMarkdown: currentMarkdownFallback, nextMarkdown: inheritedPrefix }
      : { currentMarkdown: currentMarkdownFallback };
  }

  const parent = $from.parent;
  const beforeInlineMd = serializeMarkdownFragment(editor, parent.cut(0, $from.parentOffset).content);
  const afterInlineMd = serializeMarkdownFragment(editor, parent.cut($to.parentOffset, parent.content.size).content);
  const currentMarkdown = applyListPrefix(beforeInlineMd, prefix);
  const inheritedPrefix = inferListPrefix(currentMarkdown);
  const nextMarkdown = applyListPrefix(afterInlineMd, inheritedPrefix ?? '');

  return afterInlineMd !== '' || inheritedPrefix
    ? { currentMarkdown, nextMarkdown }
    : { currentMarkdown };
}

function getImageFromPaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  return imgItem ? imgItem.getAsFile() : null;
}

async function uploadPastedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const ext = file.type === 'image/png' ? 'png'
        : file.type === 'image/gif' ? 'gif'
          : file.type === 'image/webp' ? 'webp'
            : 'jpg';
      const fileName = `paste-${Date.now()}.${ext}`;
      try {
        const res = await fetch('/__prd__/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, base64 }),
        });
        const data = await res.json();
        if (data.ok) {
          emitPrdToast('图片粘贴成功');
          resolve(data.path);
        }
        else reject(new Error(data.error));
      } catch (err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}

// ─── Tiptap extensions ────────────────────────────────────────────────────

/**
 * 自定義 HardBreak：序列化為純 `\n` 而非 tiptap-markdown 默認的 `\\\n`，
 * 配合 `Markdown.configure({ breaks: true })` 實現「直接換行」的雙向轉換。
 */
const PrdHardBreak = HardBreak.extend({
  addStorage() {
    return {
      markdown: {
        serialize(state, node, parent, index) {
          for (let i = index + 1; i < parent.childCount; i++) {
            if (parent.child(i).type !== node.type) {
              state.write('\n');
              return;
            }
          }
        },
        parse: {},
      },
    };
  },
});

/** 禁用列表節點，列表由外層 markdown 前綴管理；行內圖與預覽態 ![](…) 對齊 */
function makeEditableExtensions(placeholder) {
  return [
    StarterKit.configure({
      heading: false,
      codeBlock: false,
      horizontalRule: false,
      dropcursor: false,
      gapcursor: false,
      bulletList: false,
      orderedList: false,
      listItem: false,
      link: false,
      hardBreak: false,
    }),
    PrdHardBreak,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'prd-md-link' },
    }),
    Image.configure({
      inline: true,
      allowBase64: false,
      HTMLAttributes: { class: 'prd-md-preview-img' },
    }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({
      html: false,
      breaks: true,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}


// ─── TiptapMarkdownEditor ─────────────────────────────────────────────────

/**
 * Tiptap 富文本編輯器，內部 model 為 Markdown。
 * 列表由外層 markdown 前綴管理（`- ` / `  - ` / `1. `），
 * 行內含粗體、斜體、連結與 **行內圖**（與預覽態 `![](…)` 一致）。
 */
function TiptapEditingSurface({
  value,
  onSave,
  placeholder,
  blockId,
  cellPath,
  selectionRole,
  blockLevel,
  onBlockLevelChange,
  onEnter,
  singleLine,
  onBackspaceEmpty,
  onBackspaceMerge,
  onPasteImageAsBlock,
  onReplaceWithImage,
  onEditingFinished,
  setGlobalSelection,
  onPrefixManualChange,
  onResetOrderedStart,
  initialCaretOffset,
  onInitialCaretOffsetConsumed,
  onClose,
}) {
  const valueRef = useRef(value);
  const initialValueRef = useRef(value);
  useEffect(() => {
    initialValueRef.current = value;
  }, [value]);
  const skipNextBlurCommitRef = useRef(false);
  // 用 useState 的 lazy init 保存初始前缀字符串，只在组件创建时计算一次
  const [initialPrefix] = useState(() => {
    const parsed = parseListPrefix(value);
    return parsed ? parsed.prefix : '';
  });
  const prefixRef = useRef(initialPrefix);
  const [prefixMenuOpen, setPrefixMenuOpen] = useState(false);
  const prefixButtonRef = useRef(null);
  const prefixMenuRef = useRef(null);
  const onPrefixManualChangeRef = useRef(onPrefixManualChange);
  useEffect(() => { onPrefixManualChangeRef.current = onPrefixManualChange; }, [onPrefixManualChange]);
  const onResetOrderedStartRef = useRef(onResetOrderedStart);
  useEffect(() => { onResetOrderedStartRef.current = onResetOrderedStart; }, [onResetOrderedStart]);
  const callbacksRef = useRef({ onPasteImageAsBlock, onReplaceWithImage, onEnter, onBackspaceEmpty, onBackspaceMerge });
  useEffect(() => {
    callbacksRef.current = { onPasteImageAsBlock, onReplaceWithImage, onEnter, onBackspaceEmpty, onBackspaceMerge };
  });

  useEffect(() => { valueRef.current = value; }, [value]);

  const onSaveRef = useRef(onSave);
  useEffect(() => { onSaveRef.current = onSave; });
  const valueRefInternal = valueRef;
  const forceUpdateRef = useRef(null);

  const selectCurrentTextTarget = useCallback((e) => {
    if (!setGlobalSelection || !blockId || !selectionRole) return;
    setGlobalSelection({ type: 'text-block', blockId, role: selectionRole, cellPath });
    e?.stopPropagation?.();
  }, [setGlobalSelection, blockId, selectionRole, cellPath]);

  const editorRef = useRef(null);
  const editorContainerRef = useRef(null);
  const toolbarPanelRef = useRef(null);
  const extensions = useMemo(() => makeEditableExtensions(placeholder), [placeholder]);

  const finishEditing = useCallback(() => {
    onClose?.();
    onEditingFinished?.();
  }, [onClose, onEditingFinished]);

  const editor = useEditor({
    extensions,
    content: '',
    editable: true,
    immediatelyRender: false,
    editorProps: {
      attributes: { class: 'prd-tiptap-prosemirror' },
      handlePaste: (view, event) => {
        const file = getImageFromPaste(event);
        if (!file) return false;
        event.preventDefault();
        (async () => {
          try {
            const imgPath = await uploadPastedImage(file);
            const ed = editorRef.current;
            const currentMd = ed ? editorToMarkdown(ed) : '';
            const cbs = callbacksRef.current;
            if (currentMd.trim()) {
              commitAndExitRef.current?.(undefined, { skipNextBlur: true });
              cbs.onPasteImageAsBlock?.(imgPath);
            } else if (cbs.onReplaceWithImage) {
              cbs.onReplaceWithImage(imgPath);
            } else {
              cbs.onPasteImageAsBlock?.(imgPath);
            }
          } catch (err) {
            console.error('图片上传失败', err);
          }
        })();
        return true;
      },
      handleKeyDown: (view, event) => {
        const ed = editorRef.current;

        if (event.key === ' ' && !prefixRef.current && ed) {
          const triggerCandidate = getListTriggerCandidate(ed);
          const listTrigger = triggerCandidate.match(/^(\d+\.|[a-z]+\.|[-*+])$/);
          if (listTrigger) {
            event.preventDefault();
            const newPrefix = `${listTrigger[0]} `;
            prefixRef.current = newPrefix;
            ed.commands.setContent('');
            const fullMd = newPrefix;
            onSaveRef.current?.(fullMd);
            valueRefInternal.current = fullMd;
            forceUpdateRef.current?.();
            requestAnimationFrame(() => ed.commands.focus('end'));
            return true;
          }
        }

        if (event.key === 'Enter' && (singleLine || !event.shiftKey)) {
          if (singleLine || callbacksRef.current.onEnter) {
            event.preventDefault();
            const enterPayload = buildEnterPayload(ed, prefixRef.current);
            commitAndExitRef.current?.(enterPayload.currentMarkdown, { skipNextBlur: true });
            callbacksRef.current.onEnter?.(enterPayload);
            return true;
          }
        }
        if (event.key === 'Backspace') {
          if (!ed) return false;
          if (isRootSingleEmptyParagraph(ed.state.doc)) {
            if (prefixRef.current) {
              event.preventDefault();
              prefixRef.current = '';
              valueRefInternal.current = '';
              forceUpdateRef.current?.();
              onSaveRef.current?.('');
              return true;
            }
            if (callbacksRef.current.onBackspaceEmpty) {
              event.preventDefault();
              callbacksRef.current.onBackspaceEmpty();
              return true;
            }
          } else if (prefixRef.current) {
            const { $from } = ed.state.selection;
            if ($from.pos === 1) {
              event.preventDefault();
              const bodyMd = trimTrailingEmptyLines(editorToMarkdown(ed));
              prefixRef.current = '';
              onSaveRef.current?.(bodyMd);
              valueRefInternal.current = bodyMd;
              onPrefixManualChangeRef.current?.(bodyMd);
              forceUpdateRef.current?.();
              return true;
            }
          } else {
            const { $from } = ed.state.selection;
            if ($from.pos === 1 && callbacksRef.current.onBackspaceMerge) {
              event.preventDefault();
              const bodyMd = trimTrailingEmptyLines(editorToMarkdown(ed));
              callbacksRef.current.onBackspaceMerge(bodyMd);
              return true;
            }
          }
          return false;
        }
        if (event.key === 'Escape') {
          event.preventDefault();
          finishEditing();
          return true;
        }
        return false;
      },
    },
    onBlur: () => {
      requestAnimationFrame(() => {
        if (skipNextBlurCommitRef.current) {
          skipNextBlurCommitRef.current = false;
          return;
        }
        const activeEl = document.activeElement;
        if (activeEl instanceof Node && toolbarPanelRef.current?.contains(activeEl)) return;
        if (activeEl instanceof Node && prefixMenuRef.current?.contains(activeEl)) return;
        if (activeEl instanceof Node && prefixButtonRef.current?.contains(activeEl)) return;
        commitAndExitRef.current?.();
      });
    },
  }, [singleLine, placeholder, finishEditing]);

  useEffect(() => { editorRef.current = editor; }, [editor]);

  const commitAndExitRef = useRef(null);

  const commitAndExit = useCallback((nextMarkdown, options = {}) => {
    if (!editor) return;
    if (options.skipNextBlur) {
      skipNextBlurCommitRef.current = true;
    }
    const inlineMd = trimTrailingEmptyLines(editorToMarkdown(editor));
    const fullMd = nextMarkdown ?? mergeListPrefixWithParagraphMarkdown(inlineMd, prefixRef.current);
    if (fullMd !== valueRef.current) {
      onSave(fullMd);
    }
    valueRef.current = fullMd;
    finishEditing();
  }, [editor, onSave, finishEditing]);

  useEffect(() => { commitAndExitRef.current = commitAndExit; }, [commitAndExit]);

  const onInitialCaretConsumedRef = useRef(onInitialCaretOffsetConsumed);
  useEffect(() => {
    onInitialCaretConsumedRef.current = onInitialCaretOffsetConsumed;
  }, [onInitialCaretOffsetConsumed]);

  useEffect(() => {
    if (!editor) return;
    const md = initialValueRef.current;
    const parsed = parseListPrefix(md);
    if (parsed) {
      prefixRef.current = parsed.prefix;
      editor.commands.setContent(parsed.body || '');
    } else {
      prefixRef.current = '';
      editor.commands.setContent(md || '');
    }
    requestAnimationFrame(() => {
      editor.commands.focus();
      if (initialCaretOffset != null) {
        const docPlainLen = editor.state.doc.textContent.length;
        const clamped = Math.max(0, Math.min(initialCaretOffset, docPlainLen));
        const pos = getProseMirrorPosFromTextOffset(editor.state.doc, clamped);
        editor.commands.setTextSelection(pos);
        onInitialCaretConsumedRef.current?.();
      } else {
        editor.commands.focus('end');
      }
    });
  }, [editor, initialCaretOffset]);

  const [, forceUpdate] = useState(0);
  useEffect(() => { forceUpdateRef.current = () => forceUpdate((n) => n + 1); });

  const applyMarkdownValue = useCallback((newMd, { focus = 'end' } = {}) => {
    const parsed = parseListPrefix(newMd);
    if (parsed) {
      prefixRef.current = parsed.prefix;
      editor?.commands.setContent(parsed.body || '');
    } else {
      prefixRef.current = '';
      editor?.commands.setContent(newMd || '');
    }
    onSaveRef.current?.(newMd);
    valueRef.current = newMd;
    forceUpdate((n) => n + 1);
    onPrefixManualChangeRef.current?.(newMd);
    if (focus) {
      requestAnimationFrame(() => editor?.commands.focus(focus));
    }
  }, [editor]);

  const updatePrefix = useCallback((newPrefix) => {
    const inlineMd = editor ? trimTrailingEmptyLines(editorToMarkdown(editor)) : '';
    const newMd = mergeListPrefixWithParagraphMarkdown(inlineMd, newPrefix);
    applyMarkdownValue(newMd);
  }, [editor, applyMarkdownValue]);

  const handlePrefixMenuAction = useCallback((type, valueArg) => {
    if (!prefixRef.current) return;
    const parsed = parseListPrefix(prefixRef.current);
    if (!parsed) return;
    const isAlpha = /^[a-z]+\.$/.test(parsed.marker);
    const indentStr = parsed.indent;

    if (type === 'continue') {
      requestAnimationFrame(() => editor?.commands.focus('end'));
      return;
    }

    const startNum = type === 'restart' ? 1 : Math.max(1, valueArg || 1);
    const newMarker = isAlpha ? numToAlphaMarker(startNum) : `${startNum}.`;
    const newPrefix = `${indentStr}${newMarker} `;

    if (onResetOrderedStartRef.current) {
      const inlineMd = editor ? trimTrailingEmptyLines(editorToMarkdown(editor)) : '';
      const newMd = mergeListPrefixWithParagraphMarkdown(inlineMd, newPrefix);
      prefixRef.current = newPrefix;
      valueRef.current = newMd;
      forceUpdate((n2) => n2 + 1);
      onResetOrderedStartRef.current(newMd, startNum);
    } else {
      updatePrefix(newPrefix);
    }
  }, [editor, updatePrefix]);

  const isOrderedPrefix = useCallback((pref) => {
    if (!pref) return false;
    const parsed = parseListPrefix(pref);
    return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
  }, []);

  const getCurrentMarkdown = useCallback(() => mergeListPrefixWithParagraphMarkdown(
    editor ? trimTrailingEmptyLines(editorToMarkdown(editor)) : '',
    prefixRef.current,
  ), [editor]);

  const handleWrapperKeyDown = useCallback((e) => {
    const shortcutLevel = getShortcutBlockLevel(e);

    if (shortcutLevel && onBlockLevelChange) {
      e.preventDefault();
      e.stopPropagation();
      onBlockLevelChange(shortcutLevel, getCurrentMarkdown());
      return;
    }

    if (matchesShiftDigitShortcut(e, 8)) {
      e.preventDefault();
      e.stopPropagation();
      const fullMd = getCurrentMarkdown();
      const parsed = parseListPrefix(fullMd);
      const next = parsed && /^[-*+]$/.test(parsed.marker)
        ? switchMarkdownListKind(fullMd, 'off')
        : switchMarkdownListKind(fullMd, 'bullet');
      applyMarkdownValue(next);
      return;
    }

    if (matchesShiftDigitShortcut(e, 7)) {
      e.preventDefault();
      e.stopPropagation();
      const fullMd = getCurrentMarkdown();
      const parsed = parseListPrefix(fullMd);
      const next = parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker)
        ? switchMarkdownListKind(fullMd, 'off')
        : switchMarkdownListKind(fullMd, 'ordered');
      applyMarkdownValue(next);
      return;
    }

    if (e.key !== 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    const fullMd = mergeListPrefixWithParagraphMarkdown(
      editor ? trimTrailingEmptyLines(editorToMarkdown(editor)) : '',
      prefixRef.current,
    );
    if (!hasListPrefix(fullMd)) return;

    if (e.shiftKey) {
      if (!hasIndent(fullMd)) return;
      const newMd = adjustOrderedMarkerAfterIndent(dedentMarkdown(fullMd));
      applyMarkdownValue(newMd);
    } else {
      const newMd = adjustOrderedMarkerAfterIndent(indentMarkdown(fullMd));
      applyMarkdownValue(newMd);
    }
  }, [editor, onBlockLevelChange, getCurrentMarkdown, applyMarkdownValue]);

  return (
    <div
      ref={editorContainerRef}
      className={['prd-tiptap-editor', cellPath != null ? 'prd-tiptap-editor--in-cell' : ''].filter(Boolean).join(' ')}
      data-prd-no-block-select
      onMouseDown={selectCurrentTextTarget}
      onFocus={selectCurrentTextTarget}
      onKeyDownCapture={handleWrapperKeyDown}
    >
      {prefixRef.current && (
        <span className="prd-list-prefix">
          {renderListMarker(
            prefixRef.current,
            isOrderedPrefix(prefixRef.current) ? {
              buttonRef: prefixButtonRef,
              onClickMarker: (e) => {
                e.stopPropagation();
                setPrefixMenuOpen((v) => !v);
              },
            } : null,
          )}
        </span>
      )}
      {prefixMenuOpen && isOrderedPrefix(prefixRef.current) && (
        <ListPrefixMenu
          prefix={prefixRef.current}
          anchorRef={prefixButtonRef}
          menuRef={prefixMenuRef}
          onAction={handlePrefixMenuAction}
          onClose={() => {
            setPrefixMenuOpen(false);
            requestAnimationFrame(() => editor?.commands.focus('end'));
          }}
        />
      )}
      <SelectionToolbar
        editor={editor}
        blockLevel={blockLevel}
        onBlockLevelChange={onBlockLevelChange}
        getCurrentMarkdown={getCurrentMarkdown}
        panelRef={toolbarPanelRef}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

export const TiptapMarkdownEditor = memo(function TiptapMarkdownEditor({
  value,
  onSave,
  placeholder = '点击此处编辑（支持 Markdown）…',
  blockId,
  cellPath,
  selectionRole = 'paragraph',
  blockLevel,
  onBlockLevelChange,
  onEnter,
  singleLine = false,
  onBackspaceEmpty,
  onBackspaceMerge,
  onPasteImageAsBlock,
  onReplaceWithImage,
  onEditingFinished,
  isPreviewSelected = false,
  setGlobalSelection,
  onPrefixManualChange,
  onResetOrderedStart,
}) {
  const [editing, setEditing] = useState(false);
  /** 進入編輯態時的游標字元 offset；用 state 快照，避免 ref 被 consume 後父層重繪把 initialCaretOffset 變成 null 再次觸發子層 effect 而 focus('end')（表格內 globalSelection / hover 重繪較頻繁）。 */
  const [editingInitialCaretOffset, setEditingInitialCaretOffset] = useState(null);
  const valueRef = useRef(value);
  const previewContentRef = useRef(null);
  const pendingPreviewCaretOffsetRef = useRef(null);

  useEffect(() => { valueRef.current = value; }, [value]);

  const selectCurrentTextTarget = useCallback((e) => {
    if (!setGlobalSelection || !blockId || !selectionRole) return;
    setGlobalSelection({ type: 'text-block', blockId, role: selectionRole, cellPath });
    e?.stopPropagation?.();
  }, [setGlobalSelection, blockId, selectionRole, cellPath]);

  const handleFinishEditing = useCallback(() => {
    pendingPreviewCaretOffsetRef.current = null;
    setEditingInitialCaretOffset(null);
    setEditing(false);
  }, []);

  const handlePreviewPaste = useCallback((e) => {
    const file = getImageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    (async () => {
      try {
        const imgPath = await uploadPastedImage(file);
        const hasContent = !!valueRef.current?.trim();
        if (hasContent) {
          onPasteImageAsBlock?.(imgPath);
        } else if (onReplaceWithImage) {
          onReplaceWithImage(imgPath);
        } else {
          onPasteImageAsBlock?.(imgPath);
        }
      } catch (err) {
        console.error('图片上传失败', err);
      }
    })();
  }, [onPasteImageAsBlock, onReplaceWithImage]);

  const handlePreviewKeyDown = useCallback((e) => {
    if (e.key === 'Backspace' && !valueRef.current && onBackspaceEmpty) {
      e.preventDefault();
      onBackspaceEmpty();
    }
  }, [onBackspaceEmpty]);

  if (!editing) {
    return (
      <div
        className={[
          'prd-editable-md',
          'prd-editable-md--preview',
          cellPath != null ? 'prd-editable-md--in-cell' : '',
          isPreviewSelected ? 'prd-editable-md--preview-selected' : '',
        ].filter(Boolean).join(' ')}
        data-prd-no-block-select
        tabIndex={0}
        onMouseDown={(e) => {
          selectCurrentTextTarget(e);
          // 列表預覽：前綴 `•` / `1.` 在 .prd-list-marker 內，不在 contentRef 正文的 span 內；
          // 點在符號區時 caret API 與距離回退常錯，固定對應正文開頭（與編輯器內不含前綴的 body 一致）。
          const hitEl = e.target instanceof Element ? e.target : e.target.parentElement;
          if (hitEl?.closest('.prd-list-marker')) {
            pendingPreviewCaretOffsetRef.current = 0;
            return;
          }
          pendingPreviewCaretOffsetRef.current = getTextOffsetFromPoint(
            previewContentRef.current,
            e.clientX,
            e.clientY,
          );
        }}
        onClick={() => {
          setEditingInitialCaretOffset(pendingPreviewCaretOffsetRef.current);
          setEditing(true);
        }}
        onKeyDown={handlePreviewKeyDown}
        onPaste={handlePreviewPaste}
      >
        {value ? (
          <TiptapPreview value={value} contentRef={previewContentRef} inCell={cellPath != null} />
        ) : (
          <span className="prd-editable__placeholder">{placeholder}</span>
        )}
      </div>
    );
  }

  return (
    <TiptapEditingSurface
      value={value}
      onSave={onSave}
      placeholder={placeholder}
      blockId={blockId}
      cellPath={cellPath}
      selectionRole={selectionRole}
      blockLevel={blockLevel}
      onBlockLevelChange={onBlockLevelChange}
      onEnter={onEnter}
      singleLine={singleLine}
      onBackspaceEmpty={onBackspaceEmpty}
      onBackspaceMerge={onBackspaceMerge}
      onPasteImageAsBlock={onPasteImageAsBlock}
      onReplaceWithImage={onReplaceWithImage}
      onEditingFinished={onEditingFinished}
      setGlobalSelection={setGlobalSelection}
      onPrefixManualChange={onPrefixManualChange}
      onResetOrderedStart={onResetOrderedStart}
      initialCaretOffset={editingInitialCaretOffset}
      onInitialCaretOffsetConsumed={undefined}
      onClose={handleFinishEditing}
    />
  );
});

/** 把 markdown 前綴（如 `- `, `  - `, `1. `, `a. `）轉成視覺符號 */
function renderListMarker(prefix, interactive = null) {
  if (!prefix) return null;
  const parsed = parseListPrefix(prefix);
  if (!parsed) return null;
  const indentLevel = Math.floor(parsed.indent.length / 2);
  const isBullet = /^[-*+]$/.test(parsed.marker);
  const marker = isBullet ? '•' : parsed.marker;

  const rootBulletClass =
    isBullet && indentLevel === 0 ? ' prd-list-marker--root-bullet' : '';

  if (interactive) {
    const { buttonRef, onClickMarker } = interactive;
    return (
      <span
        className={`prd-list-marker${rootBulletClass}`.trim()}
        style={{ paddingLeft: indentLevel * 16 }}
      >
        <button
          ref={buttonRef}
          type="button"
          className="prd-list-marker__btn"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={onClickMarker}
          title="列表编号选项"
        >
          {marker}
        </button>
        {' '}
      </span>
    );
  }

  return (
    <span
      className={`prd-list-marker${rootBulletClass}`.trim()}
      style={{ paddingLeft: indentLevel * 16 }}
    >
      {marker}{' '}
    </span>
  );
}

// ─── TiptapPreview（輕量 HTML 渲染，不創建 Tiptap editor 實例） ────────────

const TiptapPreview = memo(function TiptapPreview({ value, contentRef, inCell }) {
  const html = useMemo(() => renderParagraphMarkdownPreviewToHtml(value ?? ''), [value]);

  return (
    <div className={['prd-tiptap-preview-row', inCell ? 'prd-tiptap-preview-row--in-cell' : ''].filter(Boolean).join(' ')}>
      <div
        ref={contentRef}
        className="prd-tiptap-prosemirror prd-tiptap-prosemirror--readonly"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
