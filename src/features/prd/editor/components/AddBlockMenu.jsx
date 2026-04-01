import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { BLOCK_TYPE_LABELS } from '../prd-constants.js';
import { useViewportFit } from '../useViewportFit.js';

export function AddBlockMenu({ onAdd, onClose, position = 'below' }) {
  const clickRef = useRef(null);
  const [openGroupId, setOpenGroupId] = useState(null);
  const [submenuVertical, setSubmenuVertical] = useState('below');
  const groupRefs = useRef({});
  const submenuRefs = useRef({});
  const preferred = position === 'above' ? 'above' : 'below';
  const { ref: fitRef, vertical, horizontal } = useViewportFit(preferred, 'left');
  const submenuDirection = horizontal === 'right' ? 'left' : 'right';

  const setMenuRef = useCallback((el) => {
    clickRef.current = el;
    fitRef.current = el;
  }, [fitRef]);

  useEffect(() => {
    const handler = (e) => { if (clickRef.current && !clickRef.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!openGroupId) return;
    const groupNode = groupRefs.current[openGroupId];
    const submenuNode = submenuRefs.current[openGroupId];
    if (!groupNode || !submenuNode) return;
    const groupRect = groupNode.getBoundingClientRect();
    const submenuRect = submenuNode.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const availableBelow = viewportHeight - groupRect.top - margin;
    const availableAbove = groupRect.bottom - margin;
    const fitsBelow = submenuRect.height <= availableBelow;
    const fitsAbove = submenuRect.height <= availableAbove;

    if (!fitsBelow && (fitsAbove || availableAbove > availableBelow)) {
      setSubmenuVertical('above');
    } else {
      setSubmenuVertical('below');
    }
  }, [openGroupId]);

  const items = [
    {
      id: 'text-blocks',
      type: 'group',
      label: '文本块',
      children: ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'],
    },
    { id: 'table', type: 'item', value: 'table' },
    { id: 'mermaid', type: 'item', value: 'mermaid' },
    { id: 'mindmap', type: 'item', value: 'mindmap' },
    { id: 'prd-section-template', type: 'item', value: 'prd-section-template' },
    { id: 'divider', type: 'item', value: 'divider' },
  ];

  return (
    <div
      ref={setMenuRef}
      className={[
        'prd-add-menu',
        `prd-add-menu--${vertical}`,
        horizontal === 'right' ? 'prd-add-menu--align-right' : '',
      ].filter(Boolean).join(' ')}
    >
      {items.map((item) => {
        if (item.type === 'group') {
          const expanded = openGroupId === item.id;
          return (
            <div
              key={item.id}
              className="prd-add-menu__group"
              ref={(node) => {
                if (node) groupRefs.current[item.id] = node;
                else delete groupRefs.current[item.id];
              }}
              onMouseEnter={() => setOpenGroupId(item.id)}
              onMouseLeave={() => setOpenGroupId((curr) => (curr === item.id ? null : curr))}
            >
              <button
                type="button"
                className={[
                  'prd-add-menu__item',
                  'prd-add-menu__item--branch',
                  expanded ? 'prd-add-menu__item--branch-active' : '',
                ].filter(Boolean).join(' ')}
              >
                <span>{item.label}</span>
                <span className="prd-add-menu__item-caret" aria-hidden="true">
                  {submenuDirection === 'right' ? '>' : '<'}
                </span>
              </button>
              <div
                ref={(node) => {
                  if (node) submenuRefs.current[item.id] = node;
                  else delete submenuRefs.current[item.id];
                }}
                className={[
                  'prd-add-menu__submenu',
                  submenuVertical === 'above' ? 'prd-add-menu__submenu--above' : '',
                  submenuDirection === 'left' ? 'prd-add-menu__submenu--left' : '',
                  expanded ? 'prd-add-menu__submenu--open' : '',
                ].filter(Boolean).join(' ')}
              >
                {item.children.map((child) => (
                  <button
                    key={child}
                    type="button"
                    className="prd-add-menu__item"
                    onClick={() => {
                      onAdd(child);
                      onClose();
                    }}
                  >
                    {BLOCK_TYPE_LABELS[child]}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            className="prd-add-menu__item"
            onClick={() => {
              onAdd(item.value);
              onClose();
            }}
          >
            {BLOCK_TYPE_LABELS[item.value]}
          </button>
        );
      })}
    </div>
  );
}
