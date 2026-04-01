import { BLOCK_TYPE_LABELS } from '../../prd-constants.js';

export function DeleteConfirmModal({ block, onConfirm, onCancel }) {
  return (
    <div className="prd-modal-overlay" onClick={onCancel}>
      <div className="prd-modal" onClick={(e) => e.stopPropagation()}>
        <p className="prd-modal__text">
          确定删除这个「<strong>{BLOCK_TYPE_LABELS[block.type] || block.type}</strong>」块吗？
        </p>
        <div className="prd-modal__actions">
          <button className="prd-modal__btn prd-modal__btn--cancel" onClick={onCancel}>取消</button>
          <button className="prd-modal__btn prd-modal__btn--confirm" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>
  );
}
