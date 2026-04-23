import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useViewportFit } from '../useViewportFit.js';

/**
 * 块 / 格内操作栏的「更多」下拉。
 * 只承载低频动作，高频动作（复制 MD 行号、删除）由 actionbar 常驻按钮负责。
 *
 * items 支持两种形态：
 *   - 普通项：{ id, label, onClick, disabled?, danger? }
 *   - 子菜单项：{ kind: 'submenu', id, label, children: [...] }
 *     children 结构同普通项，额外支持 active?（已选中，显示 ✓）。
 * position: 菜单相对按钮的首选方向，'below' | 'above'
 */
export function BlockMoreMenu({ items, onClose, position = 'below' }) {
  const preferred = position === 'above' ? 'above' : 'below';
  const { ref: fitRef, vertical, horizontal } = useViewportFit(preferred, 'left');
  const rootRef = useRef(null);
  const [openSubId, setOpenSubId] = useState(null);

  const setMenuRef = useCallback((el) => {
    rootRef.current = el;
    fitRef.current = el;
  }, [fitRef]);

  useEffect(() => {
    const handler = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const handleSelect = (item) => {
    if (item.disabled) return;
    item.onClick?.();
    onClose();
  };

  return (
    <div
      ref={setMenuRef}
      className={[
        'prd-more-menu',
        `prd-more-menu--${vertical}`,
        horizontal === 'right' ? 'prd-more-menu--align-right' : '',
      ].filter(Boolean).join(' ')}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {items.map((item) => {
        if (item.kind === 'submenu') {
          return (
            <SubmenuItem
              key={item.id}
              item={item}
              open={openSubId === item.id}
              onToggle={() => setOpenSubId((v) => (v === item.id ? null : item.id))}
              onOpen={() => setOpenSubId(item.id)}
              onClose={() => setOpenSubId((curr) => (curr === item.id ? null : curr))}
              onSelectChild={(child) => {
                if (child.disabled) return;
                child.onClick?.();
                onClose();
              }}
            />
          );
        }
        return (
          <button
            key={item.id}
            type="button"
            className={[
              'prd-more-menu__item',
              item.danger ? 'prd-more-menu__item--danger' : '',
            ].filter(Boolean).join(' ')}
            disabled={item.disabled}
            onClick={() => handleSelect(item)}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SubmenuItem({ item, open, onToggle, onOpen, onClose, onSelectChild }) {
  const triggerRef = useRef(null);
  const subRef = useRef(null);
  /** 子菜单相对主菜单飞出的方向，默认向右；视窗放不下时翻转 */
  const [flipSide, setFlipSide] = useState('right');
  const [submenuVertical, setSubmenuVertical] = useState('below');

  useLayoutEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const sub = subRef.current;
    if (!trigger || !sub) return;
    const rect = trigger.getBoundingClientRect();
    const subW = sub.offsetWidth || 160;
    const subH = sub.offsetHeight || sub.scrollHeight || 96;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const margin = 8;
    const spaceRight = vw - rect.right - margin;
    const spaceLeft = rect.left - margin;
    const spaceBelow = vh - rect.top - margin;
    const spaceAbove = rect.bottom - margin;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- submenu direction is measured from the current trigger/submenu geometry
    setFlipSide(spaceRight >= subW || spaceRight >= spaceLeft ? 'right' : 'left');
    setSubmenuVertical(spaceBelow >= subH || spaceBelow >= spaceAbove ? 'below' : 'above');
  }, [open]);

  return (
    <div
      className={[
        'prd-more-menu__submenu-wrap',
        open ? 'prd-more-menu__submenu-wrap--open' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={onOpen}
      onMouseLeave={onClose}
    >
      <button
        ref={triggerRef}
        type="button"
        className={[
          'prd-more-menu__item',
          'prd-more-menu__item--has-submenu',
          open ? 'prd-more-menu__item--expanded' : '',
        ].filter(Boolean).join(' ')}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={onToggle}
        onFocus={onOpen}
      >
        <span>{item.label}</span>
        <span className="prd-more-menu__caret" aria-hidden="true">▸</span>
      </button>
      {open && (
        <div
          ref={subRef}
          className={[
            'prd-more-menu__submenu',
            `prd-more-menu__submenu--${submenuVertical}`,
            `prd-more-menu__submenu--${flipSide}`,
          ].filter(Boolean).join(' ')}
        >
          {item.children?.map((child) => (
            <button
              key={child.id}
              type="button"
              className={[
                'prd-more-menu__item',
                'prd-more-menu__item--sub',
                child.active ? 'prd-more-menu__item--active' : '',
                child.danger ? 'prd-more-menu__item--danger' : '',
              ].filter(Boolean).join(' ')}
              disabled={child.disabled}
              onClick={() => onSelectChild(child)}
            >
              <span className="prd-more-menu__check" aria-hidden="true">
                {child.active ? '✓' : ''}
              </span>
              <span>{child.label}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
