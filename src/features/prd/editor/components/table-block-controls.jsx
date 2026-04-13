import { useState, useCallback, useEffect, useRef } from 'react';
import { useViewportFit } from '../useViewportFit.js';

export function TableColSelectorActions({ canDelete, onDelete }) {
  const { ref, vertical } = useViewportFit('below', 'left', { horizontal: false });
  return (
    <div
      ref={ref}
      className={[
        'prd-table-selector-actions',
        'prd-table-selector-actions--col',
        vertical === 'above' && 'prd-table-selector-actions--col--flip-v',
      ].filter(Boolean).join(' ')}
    >
      {canDelete && (
        <button
          type="button"
          className="prd-action-btn prd-action-btn--danger"
          onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
        >
          删除列
        </button>
      )}
    </div>
  );
}

export function TableRowSelectorActions({ canDelete, onDelete }) {
  const { ref, horizontal } = useViewportFit('below', 'right', { vertical: false });
  return (
    <div
      ref={ref}
      className={[
        'prd-table-selector-actions',
        'prd-table-selector-actions--row',
        horizontal === 'left' && 'prd-table-selector-actions--row--flip-h',
      ].filter(Boolean).join(' ')}
    >
      {canDelete && (
        <button
          type="button"
          className="prd-action-btn prd-action-btn--danger"
          onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
        >
          删除行
        </button>
      )}
    </div>
  );
}

export function CellChangeIntentButton({ unchanged, onToggle }) {
  return (
    <button
      type="button"
      className={[
        'prd-table-cell-change-intent',
        unchanged ? 'prd-table-cell-change-intent--active' : '',
      ].filter(Boolean).join(' ')}
      title={unchanged ? '仅参考，不修改' : '设为仅参考，不修改'}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      仅参考
    </button>
  );
}

export function CellPendingConfirmControl({
  active,
  note,
  onActivate,
  onDeactivate,
  onSaveNote,
}) {
  const rootRef = useRef(null);
  const { ref: popoverRef, vertical, horizontal } = useViewportFit('below', 'right');
  const [open, setOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(note || '');

  const commitDraftAndClose = useCallback(() => {
    onSaveNote?.(draftNote);
    setOpen(false);
  }, [draftNote, onSaveNote]);

  useEffect(() => {
    if (!open) return;
    setDraftNote(note || '');
  }, [note, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      commitDraftAndClose();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      commitDraftAndClose();
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [commitDraftAndClose, open]);

  const handleOpen = useCallback(() => {
    if (!active) onActivate?.();
    setOpen(true);
  }, [active, onActivate]);

  const handleDeactivate = useCallback(() => {
    onDeactivate?.();
    setDraftNote('');
    setOpen(false);
  }, [onDeactivate]);

  return (
    <div className="prd-table-cell-pending-confirm" ref={rootRef}>
      <button
        type="button"
        className={[
          'prd-table-cell-pending-confirm__tag',
          active ? 'prd-table-cell-pending-confirm__tag--active' : '',
        ].filter(Boolean).join(' ')}
        title={active
          ? (note ? `待确认：${note}` : '待确认，点击补充备注')
          : '标记为待确认'}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={handleOpen}
      >
        待确认
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={[
            'prd-table-cell-note-popover',
            vertical === 'above' ? 'prd-table-cell-note-popover--above' : '',
            horizontal === 'left' ? 'prd-table-cell-note-popover--align-left' : '',
          ].filter(Boolean).join(' ')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="prd-table-cell-note-popover__title">待确认备注</div>
          <textarea
            className="prd-table-cell-note-popover__textarea"
            rows={4}
            autoFocus
            placeholder="记录后续要确认的细节点，方便下次继续查看。"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
          />
          <div className="prd-table-cell-note-popover__actions">
            <button
              type="button"
              className="prd-action-btn"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={handleDeactivate}
            >
              取消标记
            </button>
            <button
              type="button"
              className="prd-action-btn prd-action-btn--active"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={commitDraftAndClose}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
