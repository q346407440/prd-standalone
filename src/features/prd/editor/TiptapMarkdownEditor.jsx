import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsLink45Deg, BsTypeBold, BsTypeItalic } from 'react-icons/bs';
import { MdFormatListNumbered } from 'react-icons/md';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import { Markdown } from 'tiptap-markdown';
import markdownit from 'markdown-it';
import { editorToMarkdown } from './tiptap-md-utils.js';
import { emitPrdToast } from './prd-toast.js';
import {
  adjustOrderedMarkerAfterIndent,
  alphaToNum,
  applyListPrefix,
  dedentMarkdown,
  hasIndent,
  hasListPrefix,
  indentMarkdown,
  inferListPrefix,
  numToAlphaMarker,
  parseListPrefix,
  switchMarkdownListKind,
} from './prd-list-utils.js';

const md = markdownit({ html: false, linkify: false, breaks: false });
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  return `<a href="${href}" class="prd-md-link" target="_blank" rel="noreferrer noopener">`;
};

const BLOCK_LEVEL_TYPES = ['paragraph', ...Array.from({ length: 7 }, (_, index) => `h${index + 1}`)];
const BLOCK_LEVEL_OPTIONS = BLOCK_LEVEL_TYPES.map((type) => ({
  value: type,
  label: type === 'paragraph' ? '正文' : type.toUpperCase(),
}));
const BUBBLE_GAP = 6;
const BUBBLE_MARGIN = 8;

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

function getTextOffsetFromPoint(container, clientX, clientY) {
  if (!container || typeof document === 'undefined') return null;
  const totalLength = container.textContent?.length ?? 0;
  let range = null;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  } else if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  }
  if (range && container.contains(range.startContainer)) {
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(container);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    return Math.max(0, Math.min(prefixRange.toString().length, totalLength));
  }
  const rect = container.getBoundingClientRect();
  if (clientX <= rect.left) return 0;
  if (clientX >= rect.right) return totalLength;
  return totalLength;
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

function serializeMarkdownFragment(editor, fragment) {
  const serializer = editor?.storage?.markdown?.serializer;
  if (!serializer) return '';
  return trimTrailingEmptyLines(serializer.serialize(fragment));
}

function buildEnterPayload(editor, prefix) {
  const inlineMd = trimTrailingEmptyLines(editorToMarkdown(editor));
  const currentMarkdownFallback = applyListPrefix(inlineMd, prefix);

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

function sameBubbleStyle(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.position === b.position
    && a.top === b.top
    && a.left === b.left
    && a.zIndex === b.zIndex;
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

/** 禁用列表節點，列表由外層 markdown 前綴管理 */
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
    }),
    Link.configure({
      openOnClick: false,
      HTMLAttributes: { class: 'prd-md-link' },
    }),
    Placeholder.configure({ placeholder }),
    Markdown.configure({
      html: false,
      transformPastedText: true,
      transformCopiedText: true,
    }),
  ];
}


// ─── SelectionToolbar ─────────────────────────────────────────────────────

function SelectionToolbar({
  editor, blockLevel, onBlockLevelChange, containerRef, getCurrentMarkdown, panelRef,
}) {
  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  const [hasTextSel, setHasTextSel] = useState(false);
  const frameRef = useRef(null);

  const hasLevelSwitcher = blockLevel != null && !!onBlockLevelChange;

  const reposition = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const textSelected = !empty && from !== to;
    setHasTextSel(textSelected);

    const self = ref.current;
    if (!self) return;

    if (textSelected) {
      const view = editor.view;
      const start = view.coordsAtPos(from);
      const end = view.coordsAtPos(to);
      if (!start) return;

      const sw = self.offsetWidth || 200;
      const sh = self.offsetHeight || 36;
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const anchorTop = Math.min(start.top, end.top);
      const anchorBottom = Math.max(start.bottom, end.bottom);
      const anchorLeft = Math.min(start.left, end.left);

      let top;
      const spaceAbove = anchorTop - BUBBLE_MARGIN;
      const spaceBelow = vh - anchorBottom - BUBBLE_MARGIN;
      if (spaceAbove >= sh + BUBBLE_GAP || spaceAbove >= spaceBelow) {
        top = anchorTop - BUBBLE_GAP - sh;
      } else {
        top = anchorBottom + BUBBLE_GAP;
      }
      top = Math.max(BUBBLE_MARGIN, Math.min(top, vh - sh - BUBBLE_MARGIN));

      let left = anchorLeft;
      left = Math.max(BUBBLE_MARGIN, Math.min(left, vw - sw - BUBBLE_MARGIN));

      const nextStyle = { position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 };
      setStyle((prev) => (sameBubbleStyle(prev, nextStyle) ? prev : nextStyle));
    } else if (hasLevelSwitcher && containerRef?.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const sw = self.offsetWidth || 200;
      const sh = self.offsetHeight || 36;
      const vw = window.innerWidth;

      let top = rect.top - BUBBLE_GAP - sh;
      top = Math.max(BUBBLE_MARGIN, top);
      let left = rect.left;
      left = Math.max(BUBBLE_MARGIN, Math.min(left, vw - sw - BUBBLE_MARGIN));

      const nextStyle = { position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 };
      setStyle((prev) => (sameBubbleStyle(prev, nextStyle) ? prev : nextStyle));
    }
  }, [editor, hasLevelSwitcher, containerRef]);

  const scheduleReposition = useCallback(() => {
    if (frameRef.current != null) return;
    frameRef.current = requestAnimationFrame(() => {
      frameRef.current = null;
      reposition();
    });
  }, [reposition]);

  useEffect(() => {
    if (!editor) return;
    const handler = () => scheduleReposition();
    const blurHandler = () => { setHasTextSel(false); };
    editor.on('selectionUpdate', handler);
    editor.on('blur', blurHandler);
    editor.on('focus', handler);
    return () => {
      if (frameRef.current != null) cancelAnimationFrame(frameRef.current);
      editor.off('selectionUpdate', handler);
      editor.off('blur', blurHandler);
      editor.off('focus', handler);
    };
  }, [editor, scheduleReposition]);

  useLayoutEffect(() => {
    reposition();
  }, [reposition]);

  const shouldShow = hasTextSel || hasLevelSwitcher;
  if (!shouldShow || !editor) return null;

  return createPortal(
    <div
      ref={ref}
      data-prd-no-block-select
      className="prd-tiptap-bubble-menu"
      style={style ?? { visibility: 'hidden', position: 'fixed' }}
      onMouseDown={(e) => {
        e.stopPropagation();
      }}
    >
      {hasTextSel && (
        <>
          <button
            type="button"
            className={[
              'prd-action-btn prd-action-btn--icon',
              editor.isActive('bold') ? 'prd-action-btn--active' : '',
            ].filter(Boolean).join(' ')}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="粗体"
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            <BsTypeBold aria-hidden="true" />
          </button>
          <button
            type="button"
            className={[
              'prd-action-btn prd-action-btn--icon',
              editor.isActive('italic') ? 'prd-action-btn--active' : '',
            ].filter(Boolean).join(' ')}
            onMouseDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            title="斜体"
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            <BsTypeItalic aria-hidden="true" />
          </button>
          <LinkButton editor={editor} />
        </>
      )}
      {hasLevelSwitcher && (
        <label className="prd-action-select-wrap" title="标题层级">
          <select
            ref={panelRef}
            className="prd-action-select"
            value={blockLevel}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            onChange={(e) => {
              const md = getCurrentMarkdown ? getCurrentMarkdown() : editorToMarkdown(editor);
              onBlockLevelChange(e.target.value, md);
            }}
          >
            {BLOCK_LEVEL_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
        </label>
      )}
    </div>,
    document.body,
  );
}

function LinkButton({ editor }) {
  const setLink = useCallback(() => {
    const previousUrl = editor.getAttributes('link').href || '';
    const url = window.prompt('链接地址', previousUrl);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run();
  }, [editor]);

  return (
    <button
      type="button"
      className={[
        'prd-action-btn prd-action-btn--icon',
        editor.isActive('link') ? 'prd-action-btn--active' : '',
      ].filter(Boolean).join(' ')}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={setLink}
      title="插入/编辑链接"
    >
      <BsLink45Deg aria-hidden="true" />
    </button>
  );
}

// ─── ListPrefixMenu ──────────────────────────────────────────────────────

/**
 * 有序列表前缀操作菜单：继续编号 / 重新开始编号 / 设置编号的值
 * onAction(type, value?) — type: 'continue' | 'restart' | 'setvalue'
 */
function ListPrefixMenu({ prefix, anchorRef, menuRef: externalMenuRef, onAction, onClose }) {
  const [showInput, setShowInput] = useState(false);
  const [inputVal, setInputVal] = useState('1');
  const menuRef = useRef(null);
  const inputRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState({ position: 'fixed', top: 0, left: 0, zIndex: 9999 });

  const setMenuRef = useCallback((node) => {
    menuRef.current = node;
    if (externalMenuRef) externalMenuRef.current = node;
    if (node) {
      const anchor = anchorRef?.current;
      if (!anchor) return;
      const rect = anchor.getBoundingClientRect();
      const mw = node.offsetWidth || 200;
      const mh = node.offsetHeight || 100;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      let top = rect.bottom + 4;
      let left = rect.left;
      if (top + mh > vh - 8) top = rect.top - mh - 4;
      if (left + mw > vw - 8) left = vw - mw - 8;
      setMenuStyle({ position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 });
    }
  }, [externalMenuRef, anchorRef]);

  const parsed = parseListPrefix(prefix);
  const isOrdered = parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
  const isAlpha = parsed && /^[a-z]+\.$/.test(parsed.marker);

  useLayoutEffect(() => {
    const anchor = anchorRef?.current;
    const menu = menuRef.current;
    if (!anchor || !menu) return;
    const rect = anchor.getBoundingClientRect();
    const mw = menu.offsetWidth || 200;
    const mh = menu.offsetHeight || 100;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    let top = rect.bottom + 4;
    let left = rect.left;
    if (top + mh > vh - 8) top = rect.top - mh - 4;
    if (left + mw > vw - 8) left = vw - mw - 8;
    setMenuStyle({ position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 });
  }, [anchorRef, showInput]);

  useEffect(() => {
    const onDown = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)
        && anchorRef?.current && !anchorRef.current.contains(e.target)) {
        onClose?.();
      }
    };
    document.addEventListener('mousedown', onDown, true);
    return () => document.removeEventListener('mousedown', onDown, true);
  }, [anchorRef, onClose]);

  useEffect(() => {
    if (showInput && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [showInput]);

  if (!isOrdered) return null;

  const currentNum = isAlpha
    ? alphaToNum(parsed.marker.slice(0, -1))
    : parseInt(parsed.marker, 10);

  return createPortal(
    <div
      ref={setMenuRef}
      className="prd-list-prefix-menu"
      style={menuStyle}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {!showInput ? (
        <>
          <button
            type="button"
            className="prd-list-prefix-menu__item"
            onClick={() => { onAction('continue'); onClose?.(); }}
          >
            <span className="prd-list-prefix-menu__icon">
              <MdFormatListNumbered aria-hidden="true" style={{ transform: 'scaleX(-1)' }} />
            </span>
            继续标题编号
          </button>
          <button
            type="button"
            className="prd-list-prefix-menu__item"
            onClick={() => { onAction('restart'); onClose?.(); }}
          >
            <span className="prd-list-prefix-menu__icon">
              <MdFormatListNumbered aria-hidden="true" />
            </span>
            重新开始编号
          </button>
          <button
            type="button"
            className="prd-list-prefix-menu__item"
            onClick={() => {
              setInputVal(String(currentNum));
              setShowInput(true);
            }}
          >
            <span className="prd-list-prefix-menu__icon prd-list-prefix-menu__icon--set">
              <span>1</span>
              <span style={{ fontSize: 9, lineHeight: 1 }}>2</span>
              <span className="prd-list-prefix-menu__pencil">✏</span>
            </span>
            设置编号的值
          </button>
        </>
      ) : (
        <div className="prd-list-prefix-menu__input-row">
          <label className="prd-list-prefix-menu__input-label">当前编号的值为</label>
          <div className="prd-list-prefix-menu__input-wrap">
            <input
              ref={inputRef}
              type="number"
              min="1"
              className="prd-list-prefix-menu__input"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  const n = Math.max(1, parseInt(inputVal, 10) || 1);
                  onAction('setvalue', n);
                  onClose?.();
                }
                if (e.key === 'Escape') onClose?.();
              }}
            />
            <div className="prd-list-prefix-menu__input-arrows">
              <button type="button" onMouseDown={(e) => { e.preventDefault(); setInputVal((v) => String(Math.max(1, (parseInt(v, 10) || 1) + 1))); }}>▲</button>
              <button type="button" onMouseDown={(e) => { e.preventDefault(); setInputVal((v) => String(Math.max(1, (parseInt(v, 10) || 1) - 1))); }}>▼</button>
            </div>
          </div>
          <button
            type="button"
            className="prd-list-prefix-menu__confirm"
            onClick={() => {
              const n = Math.max(1, parseInt(inputVal, 10) || 1);
              onAction('setvalue', n);
              onClose?.();
            }}
          >
            确定
          </button>
        </div>
      )}
    </div>,
    document.body,
  );
}

// ─── TiptapMarkdownEditor ─────────────────────────────────────────────────

/**
 * Tiptap 富文本編輯器，內部 model 為 Markdown。
 * 列表由外層 markdown 前綴管理（`- ` / `  - ` / `1. `），
 * Tiptap 只處理行內格式（粗體、斜體、連結）。
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
  onPasteImageAsBlock,
  onReplaceWithImage,
  onEditingFinished,
  globalSelection,
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
  const callbacksRef = useRef({ onPasteImageAsBlock, onReplaceWithImage, onEnter, onBackspaceEmpty });
  useEffect(() => {
    callbacksRef.current = { onPasteImageAsBlock, onReplaceWithImage, onEnter, onBackspaceEmpty };
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
    const fullMd = nextMarkdown ?? applyListPrefix(inlineMd, prefixRef.current);
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
        const pos = getProseMirrorPosFromTextOffset(editor.state.doc, initialCaretOffset);
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
    const newMd = applyListPrefix(inlineMd, newPrefix);
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
      const newMd = applyListPrefix(inlineMd, newPrefix);
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

  const getCurrentMarkdown = useCallback(() => applyListPrefix(
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
    const fullMd = applyListPrefix(
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
      className="prd-tiptap-editor"
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
        containerRef={editorContainerRef}
        getCurrentMarkdown={getCurrentMarkdown}
        panelRef={toolbarPanelRef}
      />
      <EditorContent editor={editor} />
    </div>
  );
}

export function TiptapMarkdownEditor({
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
  onPasteImageAsBlock,
  onReplaceWithImage,
  onEditingFinished,
  globalSelection,
  setGlobalSelection,
  onPrefixManualChange,
  onResetOrderedStart,
}) {
  const [editing, setEditing] = useState(false);
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
    setEditing(false);
  }, []);

  const handleInitialCaretOffsetConsumed = useCallback(() => {
    pendingPreviewCaretOffsetRef.current = null;
  }, []);

  const paragraphPreviewSelected =
    blockId
    && globalSelection?.type === 'text-block'
    && globalSelection.blockId === blockId
    && globalSelection.role === selectionRole
    && (
      cellPath == null
        ? globalSelection.cellPath == null
        : globalSelection.cellPath?.ri === cellPath.ri
          && globalSelection.cellPath?.ci === cellPath.ci
          && globalSelection.cellPath?.idx === cellPath.idx
    );

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
          paragraphPreviewSelected ? 'prd-editable-md--preview-selected' : '',
        ].filter(Boolean).join(' ')}
        title="点击编辑"
        data-prd-no-block-select
        tabIndex={0}
        onMouseDown={(e) => {
          selectCurrentTextTarget(e);
          pendingPreviewCaretOffsetRef.current = getTextOffsetFromPoint(
            previewContentRef.current,
            e.clientX,
            e.clientY,
          );
        }}
        onClick={() => setEditing(true)}
        onKeyDown={handlePreviewKeyDown}
        onPaste={handlePreviewPaste}
      >
        {value ? (
          <TiptapPreview value={value} contentRef={previewContentRef} />
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
      onPasteImageAsBlock={onPasteImageAsBlock}
      onReplaceWithImage={onReplaceWithImage}
      onEditingFinished={onEditingFinished}
      globalSelection={globalSelection}
      setGlobalSelection={setGlobalSelection}
      onPrefixManualChange={onPrefixManualChange}
      onResetOrderedStart={onResetOrderedStart}
      initialCaretOffset={pendingPreviewCaretOffsetRef.current}
      onInitialCaretOffsetConsumed={handleInitialCaretOffsetConsumed}
      onClose={handleFinishEditing}
    />
  );
}

/** 把 markdown 前綴（如 `- `, `  - `, `1. `, `a. `）轉成視覺符號 */
function renderListMarker(prefix, interactive = null) {
  if (!prefix) return null;
  const parsed = parseListPrefix(prefix);
  if (!parsed) return null;
  const indentLevel = Math.floor(parsed.indent.length / 2);
  const isBullet = /^[-*+]$/.test(parsed.marker);
  const marker = isBullet ? '•' : parsed.marker;

  if (interactive) {
    const { buttonRef, onClickMarker } = interactive;
    return (
      <span
        className="prd-list-marker"
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
      className="prd-list-marker"
      style={{ paddingLeft: indentLevel * 16 }}
    >
      {marker}{' '}
    </span>
  );
}

// ─── TiptapPreview（輕量 HTML 渲染，不創建 Tiptap editor 實例） ────────────

const TiptapPreview = memo(function TiptapPreview({ value, contentRef }) {
  const parsed = parseListPrefix(value);
  const body = parsed ? parsed.body : value;
  const prefix = parsed ? parsed.prefix : '';

  const html = useMemo(() => {
    if (!body) return '';
    const rendered = md.renderInline(body);
    return rendered;
  }, [body]);

  return (
    <div className="prd-tiptap-preview-row">
      {prefix && renderListMarker(prefix)}
      <span
        ref={contentRef}
        className="prd-tiptap-prosemirror prd-tiptap-prosemirror--readonly"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});
