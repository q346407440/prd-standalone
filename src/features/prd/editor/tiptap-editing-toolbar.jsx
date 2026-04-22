import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { BsLink45Deg, BsTypeBold, BsTypeItalic } from 'react-icons/bs';
import { MdFormatListNumbered, MdFormatListNumberedRtl, MdNumbers } from 'react-icons/md';
import {
  alphaToNum,
  numToAlphaMarker,
  parseListPrefix,
} from './prd-list-utils.js';

const BUBBLE_GAP = 6;
const BUBBLE_MARGIN = 8;

function sameBubbleStyle(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.position === b.position
    && a.top === b.top
    && a.left === b.left
    && a.zIndex === b.zIndex;
}

export function SelectionToolbar({ editor }) {
  const ref = useRef(null);
  const [style, setStyle] = useState(null);
  const [hasTextSel, setHasTextSel] = useState(false);
  const frameRef = useRef(null);

  const reposition = useCallback(() => {
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    const textSelected = !empty && from !== to;
    setHasTextSel(textSelected);

    if (!textSelected) return;

    const self = ref.current;
    if (!self) return;

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
  }, [editor]);

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

  if (!editor) return null;

  return (
    <>
      {/* 文字選取工具列：跟著選取位置浮動，保持 Portal + fixed。
          （原本常駐的「層級切換」浮層已併入 block actionbar 的「更多 → 轉換為…」） */}
      {hasTextSel && createPortal(
        <div
          ref={ref}
          data-prd-no-block-select
          className="prd-tiptap-bubble-menu"
          style={style ?? { visibility: 'hidden', position: 'fixed' }}
          onMouseDown={(e) => e.stopPropagation()}
        >
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
        </div>,
        document.body,
      )}
    </>
  );
}

export function LinkButton({ editor }) {
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

/**
 * 有序列表前缀操作菜单：继续编号 / 重新开始编号 / 设置编号的值
 * onAction(type, value?) — type: 'continue' | 'restart' | 'setvalue'
 */
export function ListPrefixMenu({ prefix, anchorRef, menuRef: externalMenuRef, onAction, onClose }) {
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
              <MdFormatListNumberedRtl aria-hidden="true" />
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
            <span className="prd-list-prefix-menu__icon">
              <MdNumbers aria-hidden="true" />
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
