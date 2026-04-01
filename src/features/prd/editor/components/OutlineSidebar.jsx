import { memo, useEffect, useRef } from 'react';
import { FiChevronsLeft, FiMenu } from 'react-icons/fi';

export const OutlineSidebar = memo(function OutlineSidebar({
  open, items, activeId, onToggle, onItemClick, onInteract,
}) {
  const scrollRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => {
    if (!open || !activeId) return;
    const container = scrollRef.current;
    const node = itemRefs.current[activeId];
    if (!container || !node) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const margin = 12;

    if (nodeRect.top < containerRect.top + margin) {
      container.scrollTo({
        top: container.scrollTop - ((containerRect.top + margin) - nodeRect.top),
        behavior: 'smooth',
      });
      return;
    }

    if (nodeRect.bottom > containerRect.bottom - margin) {
      container.scrollTo({
        top: container.scrollTop + (nodeRect.bottom - (containerRect.bottom - margin)),
        behavior: 'smooth',
      });
    }
  }, [activeId, open, items]);

  return (
    <>
      {!open && (
        <button
          type="button"
          className="prd-page__toc-toggle"
          onMouseDown={onInteract}
          onClick={onToggle}
          title="展开目录"
          aria-label="展开目录"
        >
          <FiMenu aria-hidden="true" />
        </button>
      )}
      <aside
        className={[
          'prd-page__toc-pane',
          open ? 'prd-page__toc-pane--open' : '',
        ].filter(Boolean).join(' ')}
        aria-hidden={!open}
        onMouseDown={onInteract}
      >
        <div className="prd-page__toc-shell">
          <div className="prd-page__toc-header">
            <button
              type="button"
              className="prd-page__toc-toggle prd-page__toc-toggle--inline"
              onMouseDown={onInteract}
              onClick={onToggle}
              title="收起目录"
              aria-label="收起目录"
            >
              <FiChevronsLeft aria-hidden="true" />
            </button>
            <span className="prd-page__toc-title">目录</span>
          </div>
          <div className="prd-page__toc-scroll" ref={scrollRef}>
            <div className="prd-page__toc-tree">
              {items.length ? items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  ref={(node) => {
                    if (node) itemRefs.current[item.id] = node;
                    else delete itemRefs.current[item.id];
                  }}
                  className={[
                    'prd-page__toc-item',
                    `prd-page__toc-item--level-${item.level}`,
                    activeId === item.id ? 'prd-page__toc-item--active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onItemClick(item.id)}
                  title={item.title}
                >
                  <span className="prd-page__toc-item-text">{item.title}</span>
                </button>
              )) : (
                <div className="prd-page__toc-empty">暂无目录</div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
});
