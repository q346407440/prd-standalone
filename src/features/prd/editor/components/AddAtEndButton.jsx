import { AddBlockMenu } from './AddBlockMenu.jsx';

export function AddAtEndButton({ onAdd, activeInsertMenuOwnerId, openInsertMenu, closeInsertMenu }) {
  const ownerId = 'add-at-end';
  const showMenu = activeInsertMenuOwnerId === ownerId;

  return (
    <div className="prd-add-end">
      <button
        className="prd-add-section-btn"
        onClick={() => {
          const next = !showMenu;
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
            closeInsertMenu(ownerId);
          }}
        />
      )}
    </div>
  );
}
