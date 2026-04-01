import { useState, useEffect } from 'react';
import { AddBlockMenu } from './AddBlockMenu.jsx';

export function AddAtEndButton({ onAdd, activeInsertMenuOwnerId, openInsertMenu, closeInsertMenu }) {
  const [showMenu, setShowMenu] = useState(false);
  const ownerId = 'add-at-end';

  useEffect(() => {
    if (activeInsertMenuOwnerId === ownerId) return;
    setShowMenu(false);
  }, [activeInsertMenuOwnerId]);

  return (
    <div className="prd-add-end">
      <button
        className="prd-add-section-btn"
        onClick={() => {
          const next = !showMenu;
          setShowMenu(next);
          if (next) openInsertMenu(ownerId);
          else closeInsertMenu(ownerId);
        }}
      >
        + 新增块
      </button>
      {showMenu && (
        <AddBlockMenu
          position="above"
          onAdd={onAdd}
          onClose={() => {
            setShowMenu(false);
            closeInsertMenu(ownerId);
          }}
        />
      )}
    </div>
  );
}
