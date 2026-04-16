import { useState, useCallback, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { TiptapMarkdownEditor } from '../TiptapMarkdownEditor.jsx';
import { CellRenderer } from './CellRenderer.jsx';
import { getCellColumnKey, getCellState } from '../prd-annotations.js';
import { measurePrdTask } from '../prd-performance.js';
import {
  ENABLE_TABLE_CELL_ANNOTATION_UI,
  TABLE_EDGE_HOTZONE_PX,
  TABLE_HOVER_CLOSE_DELAY_MS,
} from '../prd-constants.js';
import {
  isTableKindSelection,
  isGlobalSelectionInTableBlock,
} from '../prd-utils.js';
import { makeEmptyCell, makeEmptyRow } from '../prd-block-operations.js';
import { cellFromMarkdownString } from '../prd-inline-image-split.js';
import {
  TableColSelectorActions,
  TableRowSelectorActions,
  CellChangeIntentButton,
  CellPendingConfirmControl,
} from './table-block-controls.jsx';

function sameNumberArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameTableGeom(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameNumberArray(a.colLeft, b.colLeft)
    && sameNumberArray(a.colWidth, b.colWidth)
    && sameNumberArray(a.colRight, b.colRight)
    && sameNumberArray(a.rowTop, b.rowTop)
    && sameNumberArray(a.rowHeight, b.rowHeight)
    && sameNumberArray(a.rowBottom, b.rowBottom);
}

function resolveBoundaryHoverIndex(offset, size, index, canUseBefore, hotzone = TABLE_EDGE_HOTZONE_PX) {
  const distBefore = canUseBefore ? offset : Number.POSITIVE_INFINITY;
  const distAfter = size - offset;
  if (distBefore > hotzone && distAfter > hotzone) return null;
  return distBefore <= distAfter ? index - 1 : index;
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
  prdAssetCacheBust = 0,
  onCopyMdCursorRef,
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
  const mouseInsideWrapRef = useRef(false);
  const hoverHideTimerRef = useRef(null);
  const hoverEdgeFrameRef = useRef(null);
  const hoverEdgeRef = useRef({ col: null, row: null });
  const pendingHoverEdgeRef = useRef({ col: null, row: null });
  const tableMeasureFrameRef = useRef(null);

  const flushHoverEdges = useCallback((nextCol, nextRow) => {
    if (hoverEdgeFrameRef.current != null) {
      cancelAnimationFrame(hoverEdgeFrameRef.current);
      hoverEdgeFrameRef.current = null;
    }
    pendingHoverEdgeRef.current = { col: nextCol, row: nextRow };
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
    if (hoverSuppressed) return;
    if (globalSelection != null && !isGlobalSelectionInTableBlock(block.id, globalSelection)) return;
    if (hoverHideTimerRef.current) {
      clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
    setShowHoverBars(true);
  }, [block.id, globalSelection, hoverSuppressed]);

  const closeHoverBarsWithDelay = useCallback(() => {
    if (isGlobalSelectionInTableBlock(block.id, globalSelection)) return;
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    hoverHideTimerRef.current = setTimeout(() => {
      setShowHoverBars(false);
      flushHoverEdges(null, null);
      hoverHideTimerRef.current = null;
    }, TABLE_HOVER_CLOSE_DELAY_MS);
  }, [block.id, flushHoverEdges, globalSelection]);

  useEffect(() => () => {
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    if (hoverEdgeFrameRef.current != null) cancelAnimationFrame(hoverEdgeFrameRef.current);
    if (tableMeasureFrameRef.current != null) cancelAnimationFrame(tableMeasureFrameRef.current);
  }, []);

  useEffect(() => {
    if (hoverSuppressed) {
      if (showHoverBars) setShowHoverBars(false);
      flushHoverEdges(null, null);
      return;
    }
    if (isGlobalSelectionInTableBlock(block.id, globalSelection)) {
      setShowHoverBars(true);
      return;
    }
    if (globalSelection != null) {
      if (showHoverBars) setShowHoverBars(false);
      flushHoverEdges(null, null);
    }
  }, [block.id, flushHoverEdges, globalSelection, hoverSuppressed, showHoverBars]);

  /** 選區在表內時曾略過 mouseLeave 關閉；選區清空且游標已不在包裝上時補收橫條 */
  useEffect(() => {
    if (globalSelection != null) return;
    if (!showHoverBars) return;
    if (mouseInsideWrapRef.current) return;
    setShowHoverBars(false);
    flushHoverEdges(null, null);
  }, [flushHoverEdges, globalSelection, showHoverBars]);

  /**
   * 格內元素操作條掛在 body（Portal），游標移上去後不再觸發 td 的 mousemove/mouseleave，
   * colEdge/rowEdge 會卡在上一幀，藍色插入線與灰條仍像「被 hover」。
   * 在 document 捕獲階偵測游標是否進入格內浮層，若是則同步清邊緣（不走 rAF 避免競爭）。
   */
  useEffect(() => {
    const onPointer = (e) => {
      const t = e.target;
      if (!t || typeof t.closest !== 'function') return;
      if (!t.closest('[data-cell-action-bubble]')) return;
      flushHoverEdges(null, null);
      if (hoverHideTimerRef.current) {
        clearTimeout(hoverHideTimerRef.current);
        hoverHideTimerRef.current = null;
      }
      setShowHoverBars(false);
    };
    document.addEventListener('mousemove', onPointer, true);
    return () => {
      document.removeEventListener('mousemove', onPointer, true);
    };
  }, [flushHoverEdges]);

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
      return cellFromMarkdownString(s);
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
        onMouseEnter={() => {
          mouseInsideWrapRef.current = true;
          openHoverBars();
        }}
        onMouseLeave={() => {
          mouseInsideWrapRef.current = false;
          closeHoverBarsWithDelay();
        }}
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
                    if (e.target?.closest?.('[data-cell-action-bubble]')) return;
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
              const rowCellState = rowBinding && ENABLE_TABLE_CELL_ANNOTATION_UI
                ? getCellState(annotationsDoc, rowBinding.rowKey)
                : null;
              return (
              <tr
                key={ri}
                className={selectedRow === ri ? 'prd-table-row--selected' : ''}
              >
                {headers.map((h, ci) => {
                  const columnKey = getCellColumnKey(headers, ci);
                  const cellState = rowCellState;
                  const isLockable = ENABLE_TABLE_CELL_ANNOTATION_UI
                    && (columnKey === 'interaction' || columnKey === 'logic');
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
                      if (e.target?.closest?.('[data-cell-action-bubble]')) return;
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
                    onMouseLeave={() => scheduleHoverEdges(null, null)}
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
                      prdAssetCacheBust={prdAssetCacheBust}
                      onCopyMdCursorRef={onCopyMdCursorRef}
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
