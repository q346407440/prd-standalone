import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { FiAlertTriangle } from 'react-icons/fi';
import { TiptapMarkdownEditor } from '../TiptapMarkdownEditor.jsx';
import { CellRenderer } from './CellRenderer.jsx';
import { ActionPanel } from './FloatingActionBubble.jsx';
import { useViewportFit } from '../useViewportFit.js';
import { getCellColumnKey, getCellState, getUsageRegions } from '../prd-annotations.js';
import { measurePrdTask } from '../prd-performance.js';
import { TABLE_EDGE_HOTZONE_PX, TABLE_HOVER_CLOSE_DELAY_MS } from '../prd-constants.js';
import { isTableKindSelection, isNodeHovered, nodeContainsTarget } from '../prd-utils.js';
import { makeEmptyCell, makeEmptyRow } from '../prd-block-operations.js';

export function sameNumberArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function sameTableGeom(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameNumberArray(a.colLeft, b.colLeft)
    && sameNumberArray(a.colWidth, b.colWidth)
    && sameNumberArray(a.colRight, b.colRight)
    && sameNumberArray(a.rowTop, b.rowTop)
    && sameNumberArray(a.rowHeight, b.rowHeight)
    && sameNumberArray(a.rowBottom, b.rowBottom);
}

export function resolveBoundaryHoverIndex(offset, size, index, canUseBefore, hotzone = TABLE_EDGE_HOTZONE_PX) {
  const distBefore = canUseBefore ? offset : Number.POSITIVE_INFINITY;
  const distAfter = size - offset;
  if (distBefore > hotzone && distAfter > hotzone) return null;
  return distBefore <= distAfter ? index - 1 : index;
}

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

export function TableBlock({
  block,
  onUpdate,
  lockHeaders = false,
  globalSelection,
  setGlobalSelection,
  setActiveActionBlockId,
  rowBindings = [],
  annotationsDoc,
  onAnnotateUsage,
  onSetCellChangeIntent,
  onSetCellPendingConfirm,
  onSetCellPendingConfirmNote,
  onCellEdited,
  hoverSuppressed = false,
  mermaidMeta,
  onMermaidMetaChange,
  mindmapMeta,
  onMindmapMetaChange,
}) {
  const { headers, rows } = block.content;
  const selectedCol = globalSelection?.blockId === block.id && globalSelection.type === 'table-col'
    ? globalSelection.ci : null;
  const selectedRow = globalSelection?.blockId === block.id && globalSelection.type === 'table-row'
    ? globalSelection.ri : null;
  const [colEdge, setColEdge] = useState(null);
  const [rowEdge, setRowEdge] = useState(null);
  const [showHoverBars, setShowHoverBars] = useState(false);
  const [tableGeom, setTableGeom] = useState(null);
  const tableRef = useRef(null);
  const wrapRef = useRef(null);
  const hoverHideTimerRef = useRef(null);
  const hoverEdgeFrameRef = useRef(null);
  const hoverEdgeRef = useRef({ col: null, row: null });
  const pendingHoverEdgeRef = useRef({ col: null, row: null });
  const tableMeasureFrameRef = useRef(null);

  const flushHoverEdges = useCallback((nextCol, nextRow) => {
    if (hoverEdgeRef.current.col !== nextCol) {
      hoverEdgeRef.current.col = nextCol;
      setColEdge(nextCol);
    }
    if (hoverEdgeRef.current.row !== nextRow) {
      hoverEdgeRef.current.row = nextRow;
      setRowEdge(nextRow);
    }
  }, []);

  const scheduleHoverEdges = useCallback((nextCol, nextRow) => {
    pendingHoverEdgeRef.current = { col: nextCol, row: nextRow };
    if (hoverEdgeFrameRef.current != null) return;
    hoverEdgeFrameRef.current = requestAnimationFrame(() => {
      hoverEdgeFrameRef.current = null;
      flushHoverEdges(pendingHoverEdgeRef.current.col, pendingHoverEdgeRef.current.row);
    });
  }, [flushHoverEdges]);

  const openHoverBars = useCallback(() => {
    if (globalSelection != null || hoverSuppressed) return;
    if (hoverHideTimerRef.current) {
      clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
    setShowHoverBars(true);
  }, [globalSelection, hoverSuppressed]);

  const closeHoverBarsWithDelay = useCallback(() => {
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    hoverHideTimerRef.current = setTimeout(() => {
      setShowHoverBars(false);
      flushHoverEdges(null, null);
      hoverHideTimerRef.current = null;
    }, TABLE_HOVER_CLOSE_DELAY_MS);
  }, [flushHoverEdges]);

  useEffect(() => () => {
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    if (hoverEdgeFrameRef.current != null) cancelAnimationFrame(hoverEdgeFrameRef.current);
    if (tableMeasureFrameRef.current != null) cancelAnimationFrame(tableMeasureFrameRef.current);
  }, []);

  useEffect(() => {
    if (globalSelection == null && !hoverSuppressed) return;
    if (showHoverBars) setShowHoverBars(false);
    flushHoverEdges(null, null);
  }, [flushHoverEdges, globalSelection, hoverSuppressed, showHoverBars]);

  const measureTable = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    measurePrdTask('table-measure', () => {
      const ths = table.querySelectorAll('thead tr th');
      const colLeft = [];
      const colWidth = [];
      const colRight = [];
      let x = 0;
      for (let i = 0; i < ths.length; i++) {
        colLeft.push(x);
        const w = ths[i].offsetWidth;
        colWidth.push(w);
        colRight.push(x + w);
        x += w;
      }
      const thead = table.querySelector('thead');
      const theadH = thead ? thead.offsetHeight : 0;
      const trs = table.querySelectorAll('tbody tr');
      const rowTop = [];
      const rowHeight = [];
      const rowBottom = [];
      let y = theadH;
      for (let i = 0; i < trs.length; i++) {
        rowTop.push(y);
        const h = trs[i].offsetHeight;
        rowHeight.push(h);
        rowBottom.push(y + h);
        y += h;
      }
      const nextGeom = { colLeft, colWidth, colRight, rowTop, rowHeight, rowBottom };
      setTableGeom((prev) => (sameTableGeom(prev, nextGeom) ? prev : nextGeom));
    }, { headerCount: headers.length, rowCount: rows.length });
  }, [headers.length, rows.length]);

  const scheduleTableMeasure = useCallback(() => {
    if (tableMeasureFrameRef.current != null) return;
    tableMeasureFrameRef.current = requestAnimationFrame(() => {
      tableMeasureFrameRef.current = null;
      measureTable();
    });
  }, [measureTable]);

  useLayoutEffect(() => {
    scheduleTableMeasure();
  }, [scheduleTableMeasure, headers.length, rows.length, block.content]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      scheduleTableMeasure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleTableMeasure]);

  const clearThisTableSelection = useCallback(() => {
    setGlobalSelection((prev) => {
      if (!prev || prev.blockId !== block.id) return prev;
      return isTableKindSelection(prev) ? null : prev;
    });
  }, [block.id, setGlobalSelection]);

  const clearOtherUiStateForTableAction = useCallback(() => {
    setActiveActionBlockId(null);
    setGlobalSelection(null);
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl !== document.body) {
      activeEl.blur();
    }
  }, [setActiveActionBlockId, setGlobalSelection]);

  const selectCol = useCallback((ci) => {
    clearOtherUiStateForTableAction();
    setGlobalSelection({ blockId: block.id, type: 'table-col', ci });
  }, [block.id, setGlobalSelection, clearOtherUiStateForTableAction]);

  const selectRow = useCallback((ri) => {
    clearOtherUiStateForTableAction();
    setGlobalSelection({ blockId: block.id, type: 'table-row', ri });
  }, [block.id, setGlobalSelection, clearOtherUiStateForTableAction]);

  const normRows = rows.map((row) =>
    row.map((cell) => {
      if (cell && typeof cell === 'object' && Array.isArray(cell.elements)) return cell;
      if (cell && typeof cell === 'object' && 'element' in cell) {
        return { elements: [cell.element] };
      }
      const s = cell || '';
      const imgMatch = s.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) return { elements: [{ type: 'image', src: imgMatch[2] }] };
      return { elements: [{ type: 'text', markdown: s }] };
    })
  );

  const updateCell = (ri, ci, newCellEl) => {
    const newRows = normRows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? newCellEl : c) : r);
    onUpdate({ ...block, content: { ...block.content, rows: newRows } });
    const rowBinding = rowBindings[ri];
    const columnKey = getCellColumnKey(headers, ci);
    if (rowBinding && (columnKey === 'interaction' || columnKey === 'logic')) {
      onCellEdited?.(rowBinding.rowKey, rowBinding.usages?.[0]?.usageId || '', columnKey);
    }
  };
  const updateHeader = (ci, v) => {
    const newHeaders = headers.map((h, i) => i === ci ? v : h);
    onUpdate({ ...block, content: { ...block.content, headers: newHeaders } });
  };
  const insertRowAfter = (ri) => {
    clearOtherUiStateForTableAction();
    const newRows = [...normRows];
    newRows.splice(ri + 1, 0, Array(headers.length).fill(null).map(makeEmptyCell));
    onUpdate({ ...block, content: { ...block.content, rows: newRows } });
    clearThisTableSelection();
  };
  const insertColAfter = (ci) => {
    clearOtherUiStateForTableAction();
    const emptyCell = makeEmptyCell;
    onUpdate({
      ...block,
      content: {
        ...block.content,
        headers: [...headers.slice(0, ci + 1), '新列名', ...headers.slice(ci + 1)],
        rows: normRows.map((r) => [...r.slice(0, ci + 1), emptyCell(), ...r.slice(ci + 1)]),
      },
    });
    clearThisTableSelection();
  };
  const deleteRow = (ri) => {
    if (normRows.length <= 1) return;
    clearOtherUiStateForTableAction();
    onUpdate({ ...block, content: { ...block.content, rows: normRows.filter((_, i) => i !== ri) } });
    clearThisTableSelection();
  };
  const deleteCol = (ci) => {
    if (headers.length <= 1) return;
    clearOtherUiStateForTableAction();
    onUpdate({
      ...block,
      content: {
        ...block.content,
        headers: headers.filter((_, i) => i !== ci),
        rows: normRows.map((r) => r.filter((_, i) => i !== ci)),
      },
    });
    clearThisTableSelection();
  };

  const gColLeft = (ci) => tableGeom?.colLeft[ci] ?? 0;
  const gColWidth = (ci) => tableGeom?.colWidth[ci] ?? 0;
  const gColRight = (ci) => tableGeom?.colRight[ci] ?? 0;
  const gRowTop = (ri) => tableGeom?.rowTop[ri] ?? 0;
  const gRowHeight = (ri) => tableGeom?.rowHeight[ri] ?? 0;
  const gRowBottom = (ri) => tableGeom?.rowBottom[ri] ?? 0;

  const foreignSel = globalSelection != null && globalSelection.blockId !== block.id
    && isTableKindSelection(globalSelection);
  const localSel = globalSelection != null && globalSelection.blockId === block.id
    && isTableKindSelection(globalSelection);
  const suppressHandles = globalSelection != null;

  const displayRows = normRows;

  return (
    <div className="prd-block-table">
      <div
        ref={wrapRef}
        className={[
          'prd-table-wrap',
          'prd-block-table__wrap',
          showHoverBars ? 'prd-block-table__wrap--show-bars' : '',
          foreignSel ? 'prd-block-table__wrap--foreign-selection' : '',
          localSel ? 'prd-block-table__wrap--has-selection' : '',
        ].filter(Boolean).join(' ')}
        onMouseEnter={openHoverBars}
        onMouseLeave={closeHoverBarsWithDelay}
      >
        <table
          className="prd-table"
          ref={tableRef}
        >
          <colgroup>{headers.map((_, i) => <col key={i} />)}</colgroup>
          <thead>
            <tr>
              {headers.map((h, ci) => {
                return (
                <th
                  key={ci}
                  scope="col"
                  className={[
                    selectedCol === ci ? 'prd-table-col--selected' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseDownCapture={(e) => {
                    if (e.target.closest('.prd-editable, .prd-editable-md')) return;
                    if (localSel) clearThisTableSelection();
                  }}
                  onMouseMove={(e) => {
                    if (suppressHandles) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nextColEdge = resolveBoundaryHoverIndex(
                      e.clientX - rect.left,
                      rect.width,
                      ci,
                      ci > 0,
                    );
                    scheduleHoverEdges(nextColEdge, hoverEdgeRef.current.row);
                  }}
                  onMouseLeave={() => scheduleHoverEdges(null, hoverEdgeRef.current.row)}
                >
                  {lockHeaders
                    ? h
                    : (
                      <TiptapMarkdownEditor
                        value={h}
                        onSave={(v) => updateHeader(ci, v)}
                        placeholder="列名称"
                        blockId={block.id}
                        selectionRole={`th-${ci}`}
                        globalSelection={globalSelection}
                        setGlobalSelection={setGlobalSelection}
                        singleLine
                      />
                    )}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, ri) => {
              const rowBinding = rowBindings[ri];
              const rowCellState = rowBinding ? getCellState(annotationsDoc, rowBinding.rowKey) : null;
              return (
              <tr
                key={ri}
                className={selectedRow === ri ? 'prd-table-row--selected' : ''}
              >
                {headers.map((h, ci) => {
                  const columnKey = getCellColumnKey(headers, ci);
                  const cellState = rowCellState;
                  const isLockable = columnKey === 'interaction' || columnKey === 'logic';
                  const unchanged = cellState?.[columnKey]?.changeIntent === 'unchanged';
                  const pendingConfirm = Boolean(cellState?.[columnKey]?.pendingConfirm);
                  const pendingConfirmNote = cellState?.[columnKey]?.pendingConfirmNote || '';
                  return (
                  <td
                    key={ci}
                    data-prd-label={h}
                    className={[
                      selectedCol === ci ? 'prd-table-col--selected' : '',
                      unchanged ? 'prd-table-cell--unchanged' : '',
                      pendingConfirm ? 'prd-table-cell--pending-confirm' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseDownCapture={(e) => {
                      if (e.target.closest('.prd-editable-md')) return;
                      if (localSel) clearThisTableSelection();
                    }}
                    onMouseMove={(e) => {
                      if (suppressHandles) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const nextRowEdge = resolveBoundaryHoverIndex(
                        e.clientY - rect.top,
                        rect.height,
                        ri,
                        ri > 0,
                      );
                      const nextColEdge = resolveBoundaryHoverIndex(
                        e.clientX - rect.left,
                        rect.width,
                        ci,
                        ci > 0,
                      );
                      scheduleHoverEdges(nextColEdge, nextRowEdge);
                    }}
                  >
                    {isLockable && rowBinding && (
                      <div className="prd-table-cell-controls">
                        <CellPendingConfirmControl
                          active={pendingConfirm}
                          note={pendingConfirmNote}
                          onActivate={() => onSetCellPendingConfirm?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            true,
                          )}
                          onDeactivate={() => onSetCellPendingConfirm?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            false,
                          )}
                          onSaveNote={(nextNote) => onSetCellPendingConfirmNote?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            nextNote,
                          )}
                        />
                        <CellChangeIntentButton
                          unchanged={unchanged}
                          onToggle={() => onSetCellChangeIntent?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            unchanged ? 'default' : 'unchanged',
                          )}
                        />
                      </div>
                    )}
                    <CellRenderer
                      cellElement={row[ci]}
                      onUpdate={(newCellEl) => updateCell(ri, ci, newCellEl)}
                      blockId={block.id}
                      ri={ri}
                      ci={ci}
                      globalSelection={globalSelection}
                      setGlobalSelection={setGlobalSelection}
                      rowBinding={rowBinding}
                      annotationsDoc={annotationsDoc}
                      onAnnotateUsage={onAnnotateUsage}
                      hoverSuppressed={hoverSuppressed}
                      mermaidMeta={mermaidMeta}
                      onMermaidMetaChange={onMermaidMetaChange}
                      mindmapMeta={mindmapMeta}
                      onMindmapMetaChange={onMindmapMetaChange}
                    />
                  </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>

        {headers.map((_, ci) => (
          <div
            key={`col-bar-${ci}`}
            className={`prd-table-col-bar${selectedCol === ci ? ' prd-table-col-bar--selected' : ''}`}
            style={{ left: gColLeft(ci), width: gColWidth(ci) }}
            onMouseEnter={openHoverBars}
            onMouseLeave={closeHoverBarsWithDelay}
            onMouseDown={(e) => {
              e.preventDefault();
              if (selectedCol === ci) clearThisTableSelection();
              else selectCol(ci);
            }}
          >
            {selectedCol === ci && (
              <TableColSelectorActions
                canDelete={headers.length > 1}
                onDelete={() => deleteCol(ci)}
              />
            )}
          </div>
        ))}

        {displayRows.map((_, ri) => (
          <div
            key={`row-bar-${ri}`}
            className={`prd-table-row-bar${selectedRow === ri ? ' prd-table-row-bar--selected' : ''}`}
            style={{ top: gRowTop(ri), height: gRowHeight(ri) }}
            onMouseEnter={openHoverBars}
            onMouseLeave={closeHoverBarsWithDelay}
            onMouseDown={(e) => {
              e.preventDefault();
              if (selectedRow === ri) clearThisTableSelection();
              else selectRow(ri);
            }}
          >
            {selectedRow === ri && (
              <TableRowSelectorActions
                canDelete={rows.length > 1}
                onDelete={() => deleteRow(ri)}
              />
            )}
          </div>
        ))}


        {colEdge !== null && !suppressHandles && (
          <div
            className="prd-table-col-handle"
            style={{ left: gColRight(colEdge) }}
            onMouseEnter={() => flushHoverEdges(colEdge, hoverEdgeRef.current.row)}
            onMouseLeave={() => flushHoverEdges(null, hoverEdgeRef.current.row)}
          >
            <div className="prd-table-col-handle__line" />
            <button
              className="prd-table-handle__btn"
              title="插入列"
              onMouseDown={(e) => { e.preventDefault(); insertColAfter(colEdge); }}
            >＋</button>
          </div>
        )}

        {rowEdge !== null && !suppressHandles && (
          <div
            className="prd-table-row-handle"
            style={{ top: gRowBottom(rowEdge) }}
            onMouseEnter={() => flushHoverEdges(hoverEdgeRef.current.col, rowEdge)}
            onMouseLeave={() => flushHoverEdges(hoverEdgeRef.current.col, null)}
          >
            <div className="prd-table-row-handle__line" />
            <button
              className="prd-table-handle__btn"
              title="插入行"
              onMouseDown={(e) => { e.preventDefault(); insertRowAfter(rowEdge); }}
            >＋</button>
          </div>
        )}
      </div>
    </div>
  );
}
