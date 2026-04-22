import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { nodeContainsTarget } from '../prd-utils.js';
import { BLOCK_LEVEL_OPTIONS } from '../prd-constants.js';
import { ActionPanel } from './FloatingActionBubble.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
import { BlockMoreMenu } from './BlockMoreMenu.jsx';
import { HeadingBlock } from './blocks/HeadingBlock.jsx';
import { ParagraphBlock } from './blocks/ParagraphBlock.jsx';
import { DividerBlock } from './blocks/DividerBlock.jsx';
import { MermaidBlock } from './blocks/MermaidBlock.jsx';
import { MindmapBlock } from './blocks/MindmapBlock.jsx';
import { TableBlock } from './TableBlock.jsx';

export const BlockItem = memo(function BlockItem({
  block, onUpdate, onDelete, onDuplicate, onInsertBefore, onInsertAfter,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  activeActionBlockId, requestActionbarOpen, requestActionbarClose, keepActionbarOpen, clearActionbarState,
  activeInsertMenuOwnerId, openInsertMenu, closeInsertMenu,
  setHoveredActionBlockId, clearHoveredActionBlockId,
  globalSelection, setGlobalSelection,
  shouldFocus, onFocusConsumed,
  onEnterBlock, onBackspaceEmptyBlock, onBackspaceMergeBlock, onPasteImageAsBlockBlock,
  imageMeta, onImageWidthChange, prdAssetCacheBust = 0,
  setFocusBlockId, registerBlockRef, onEditingFinishedBlock,
  rowBindings,
  annotationsDoc,
  onAnnotateUsage,
  onSetCellChangeIntent,
  onSetCellPendingConfirm,
  onSetCellPendingConfirmNote,
  onCellEdited,
  onResetOrderedStartBlock,
  mermaidMeta, onMermaidMetaChange,
  mindmapMeta, onMindmapMetaChange,
  onCopyMdCursorRef,
  maxFirstLineIndentLevel = 0,
}) {
  const [showInsertMenu, setShowInsertMenu] = useState(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const suppressActionbarUntilLeaveRef = useRef(false);
  const rootRef = useRef(null);
  /** 選區在「其他 block」時，不應開啟本 block 的操作欄 */
  const selectionOnOtherBlock = globalSelection != null && globalSelection.blockId !== block.id;
  /** 主文或表格內 Tiptap：選區類型為 text-block 且屬於本 block（含儲存格） */
  const isTextUiAnchoredOnThisBlock = globalSelection?.blockId === block.id
    && globalSelection?.type === 'text-block';
  /** 文字類 block（標題 / 段落）：hover 不觸發操作欄，只有進入編輯態才顯示 */
  const isTextBlock = block.type === 'paragraph'
    || block.type === 'h1' || block.type === 'h2' || block.type === 'h3'
    || block.type === 'h4' || block.type === 'h5' || block.type === 'h6' || block.type === 'h7';
  const insertMenuOwnerId = block.id;

  useEffect(() => {
    if (activeInsertMenuOwnerId === insertMenuOwnerId) return;
    setShowInsertMenu(null);
  }, [activeInsertMenuOwnerId, insertMenuOwnerId]);

  const openActionbar = (event) => {
    if (selectionOnOtherBlock) return;
    if (suppressActionbarUntilLeaveRef.current) return;
    if (isTextBlock) return;
    /* 表格等 block：游標從外側進入「未選中的圖片」時不打開底部操作欄，僅在圖片已選中時與選區聯動 */
    const t = event?.target;
    if (t && typeof t.closest === 'function') {
      const imgRoot = t.closest('.prd-image-renderer[data-prd-img-sel]');
      if (imgRoot) {
        const hoveredKey = imgRoot.getAttribute('data-prd-img-sel');
        const sel = globalSelection;
        const selectedKey = sel?.type === 'image' && sel.blockId === block.id
          ? (sel.cellPath != null
            ? `${sel.cellPath.ri}-${sel.cellPath.ci}-${sel.cellPath.idx}`
            : 'block')
          : null;
        if (selectedKey !== hoveredKey) return;
      }
    }
    setHoveredActionBlockId?.(block.id);
    requestActionbarOpen(block.id);
  };

  /** 與 PrdPage.setGlobalSelectionWithActionbar 並行：涵蓋 effect 順序／少數未經包裝 setState 路徑 */
  useEffect(() => {
    if (globalSelection == null || globalSelection.blockId !== block.id) return;
    if (suppressActionbarUntilLeaveRef.current) return;
    requestActionbarOpen(block.id, { immediate: true });
  }, [block.id, globalSelection, requestActionbarOpen]);

  const closeActionbarWithDelay = () => {
    requestActionbarClose(block.id);
    setShowInsertMenu(null);
    setShowMoreMenu(false);
    closeInsertMenu(insertMenuOwnerId);
  };

  const closeActionbarImmediately = useCallback(() => {
    requestActionbarClose(block.id, { immediate: true });
    setShowInsertMenu(null);
    setShowMoreMenu(false);
    closeInsertMenu(insertMenuOwnerId);
  }, [block.id, closeInsertMenu, insertMenuOwnerId, requestActionbarClose]);

  const handleEnter = useCallback((md) => {
    onEnterBlock(block.id, md, block.type);
  }, [onEnterBlock, block.id, block.type]);

  const handleBackspaceEmpty = useCallback(() => {
    onBackspaceEmptyBlock(block.id);
  }, [onBackspaceEmptyBlock, block.id]);

  const handleBackspaceMerge = useCallback((currentMd) => {
    onBackspaceMergeBlock?.(block.id, currentMd);
  }, [onBackspaceMergeBlock, block.id]);

  const handlePasteImageAsBlock = useCallback((src) => {
    onPasteImageAsBlockBlock(block.id, src);
  }, [onPasteImageAsBlockBlock, block.id]);

  const handleEditingFinished = useCallback(() => {
    onEditingFinishedBlock?.(block.id);
  }, [onEditingFinishedBlock, block.id]);

  const contentRef = useRef(null);
  useEffect(() => {
    if (!shouldFocus) return;
    suppressActionbarUntilLeaveRef.current = true;
    clearActionbarState();
    const el = contentRef.current?.querySelector(
      'input, textarea, [contenteditable], .prd-editable--view, .prd-editable-md--preview, .prd-image-renderer'
    );
    if (el) {
      el.click?.();
      el.focus?.();
    }
    onFocusConsumed?.();
  }, [shouldFocus, onFocusConsumed, clearActionbarState]);

  useEffect(() => {
    if (activeActionBlockId !== block.id || selectionOnOtherBlock || suppressActionbarUntilLeaveRef.current) return undefined;
    const handlePointerOutside = (event) => {
      const t = event.target;
      if (nodeContainsTarget(rootRef.current, t)) return;
      // Tiptap 選區工具列 / 連結等氣泡掛在 body，仍屬當前編輯上下文
      if (t && typeof t.closest === 'function') {
        if (t.closest('.prd-tiptap-bubble-menu')) return;
        if (t.closest('.prd-floating-action-bubble')) return;
      }
      // 游標經過間隙移向工具列時：只要焦點仍在本 block 內，不收操作欄
      if (
        isTextUiAnchoredOnThisBlock
        && rootRef.current?.contains(document.activeElement)
      ) {
        return;
      }
      closeActionbarImmediately();
    };
    const handleWindowMouseOut = (event) => {
      if (event.relatedTarget == null) closeActionbarImmediately();
    };
    document.addEventListener('mousemove', handlePointerOutside, true);
    document.addEventListener('mousedown', handlePointerOutside, true);
    window.addEventListener('blur', closeActionbarImmediately);
    window.addEventListener('mouseout', handleWindowMouseOut);
    return () => {
      document.removeEventListener('mousemove', handlePointerOutside, true);
      document.removeEventListener('mousedown', handlePointerOutside, true);
      window.removeEventListener('blur', closeActionbarImmediately);
      window.removeEventListener('mouseout', handleWindowMouseOut);
    };
  }, [activeActionBlockId, block.id, closeActionbarImmediately, isTextUiAnchoredOnThisBlock, selectionOnOtherBlock]);

  const renderContent = () => {
    switch (block.type) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'h7':
        return (
          <HeadingBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={handleEnter}
            onBackspaceEmpty={handleBackspaceEmpty}
            setFocusBlockId={setFocusBlockId}
            onEditingFinished={handleEditingFinished}
          />
        );
      case 'paragraph':
        return (
          <ParagraphBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={handleEnter}
            onBackspaceEmpty={handleBackspaceEmpty}
            onBackspaceMerge={handleBackspaceMerge}
            onPasteImageAsBlock={handlePasteImageAsBlock}
            imageMeta={imageMeta}
            onImageWidthChange={onImageWidthChange}
            prdAssetCacheBust={prdAssetCacheBust}
            setFocusBlockId={setFocusBlockId}
            onEditingFinished={handleEditingFinished}
            onMoveUp={() => onMoveUp(block.id)}
            onMoveDown={() => onMoveDown(block.id)}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onResetOrderedStart={onResetOrderedStartBlock ? (newMd, startNum) => onResetOrderedStartBlock(block.id, newMd, startNum) : undefined}
            maxFirstLineIndentLevel={maxFirstLineIndentLevel}
          />
        );
      case 'divider':
        return <DividerBlock />;
      case 'mermaid':
        return (
          <MermaidBlock
            block={block}
            onUpdate={onUpdate}
            mermaidMeta={mermaidMeta}
            onMermaidMetaChange={onMermaidMetaChange}
          />
        );
      case 'mindmap':
        return (
          <MindmapBlock
            block={block}
            onUpdate={onUpdate}
            mindmapMeta={mindmapMeta}
            onMindmapMetaChange={onMindmapMetaChange}
          />
        );
      case 'table':
        return (
          <TableBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            setActiveActionBlockId={clearActionbarState}
            rowBindings={rowBindings}
            annotationsDoc={annotationsDoc}
            onAnnotateUsage={onAnnotateUsage}
            onSetCellChangeIntent={onSetCellChangeIntent}
            onSetCellPendingConfirm={onSetCellPendingConfirm}
            onSetCellPendingConfirmNote={onSetCellPendingConfirmNote}
            onCellEdited={onCellEdited}
            hoverSuppressed={activeInsertMenuOwnerId != null}
            mermaidMeta={mermaidMeta}
            onMermaidMetaChange={onMermaidMetaChange}
            mindmapMeta={mindmapMeta}
            onMindmapMetaChange={onMindmapMetaChange}
            prdAssetCacheBust={prdAssetCacheBust}
            onCopyMdCursorRef={onCopyMdCursorRef}
          />
        );
      default:
        return <div className="prd-block-unknown">未知 Block 类型：{block.type}</div>;
    }
  };

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        registerBlockRef?.(block.id, node);
      }}
      data-prd-block-id={block.id}
      className={[
        'prd-block-item',
        (activeActionBlockId === block.id || showInsertMenu != null || showMoreMenu) ? 'prd-block-item--action-active' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={(e) => openActionbar(e)}
      onMouseLeave={() => {
        clearHoveredActionBlockId?.(block.id);
        suppressActionbarUntilLeaveRef.current = false;
        // 預覽→編輯 DOM 替換或移向 body 上的格式條時會誤觸 leave；編輯態下保持操作欄常駐
        if (isTextUiAnchoredOnThisBlock) return;
        closeActionbarWithDelay();
      }}
    >
      {/* Block 内容 */}
      <div className="prd-block-content" ref={contentRef}>
        {renderContent()}
      </div>

      {/* 下方浮层 actionbar（hover 时显示） */}
      <ActionPanel
        visible={
          activeActionBlockId === block.id
          && !selectionOnOtherBlock
          && (
            !suppressActionbarUntilLeaveRef.current
            || isTextUiAnchoredOnThisBlock
          )
        }
        className="prd-block-actionbar"
        onMouseEnter={() => {
          setHoveredActionBlockId?.(block.id);
          keepActionbarOpen(block.id);
        }}
        onMouseLeave={(e) => {
          const next = e.relatedTarget;
          if (!(next instanceof Node) || !rootRef.current?.contains(next)) {
            clearHoveredActionBlockId?.(block.id);
          }
          if (isTextUiAnchoredOnThisBlock) {
            if (next && rootRef.current?.contains(next)) return;
            if (next && typeof next.closest === 'function' && next.closest('.prd-tiptap-bubble-menu')) return;
          }
          closeActionbarWithDelay();
        }}
      >
        {onCopyMdCursorRef ? (
          <button
            type="button"
            className="prd-action-btn prd-block-actionbar__btn prd-action-btn--primary"
            title="复制 @文件:行号，供粘贴到 Cursor"
            onClick={() => onCopyMdCursorRef({ blockId: block.id, cellPath: null })}
          >
            复制 MD 行号
          </button>
        ) : null}
        <button
          className="prd-action-btn prd-action-btn--danger prd-block-actionbar__btn prd-block-actionbar__btn--delete"
          onClick={() => onDelete(block.id)}
        >
          删除
        </button>
        <div
          className="prd-block-actionbar__more"
          onMouseEnter={() => {
            setShowMoreMenu(true);
            setShowInsertMenu(null);
            closeInsertMenu(insertMenuOwnerId);
          }}
          onMouseLeave={() => setShowMoreMenu(false)}
        >
          <button
            type="button"
            className={[
              'prd-action-btn',
              'prd-block-actionbar__btn',
              'prd-action-btn--icon-text',
              showMoreMenu ? 'prd-action-btn--active' : '',
            ].filter(Boolean).join(' ')}
            title="更多操作"
            aria-haspopup="menu"
            aria-expanded={showMoreMenu}
            onFocus={() => {
              setShowMoreMenu(true);
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
            onClick={() => {
              setShowMoreMenu((v) => !v);
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
          >
            更多
            <span className="prd-action-btn__caret" aria-hidden="true">▾</span>
          </button>
          {showMoreMenu && (
            <BlockMoreMenu
              position="below"
              onClose={() => setShowMoreMenu(false)}
              items={[
                ...(isTextBlock ? [{
                  kind: 'submenu',
                  id: 'convert-to',
                  label: '转换为…',
                  children: BLOCK_LEVEL_OPTIONS.map((option) => ({
                    id: `level-${option.value}`,
                    label: option.label,
                    active: option.value === block.type,
                    disabled: option.value === block.type,
                    onClick: () => onUpdate({ ...block, type: option.value }),
                  })),
                }] : []),
                {
                  id: 'duplicate',
                  label: '复制整块',
                  onClick: () => onDuplicate(block.id),
                },
                {
                  id: 'insert-above',
                  label: '上方插入…',
                  onClick: () => {
                    setShowInsertMenu('above');
                    openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
                  },
                },
                {
                  id: 'insert-below',
                  label: '下方插入…',
                  onClick: () => {
                    setShowInsertMenu('below');
                    openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
                  },
                },
                {
                  id: 'move-up',
                  label: '上移',
                  disabled: !canMoveUp,
                  onClick: () => onMoveUp(block.id),
                },
                {
                  id: 'move-down',
                  label: '下移',
                  disabled: !canMoveDown,
                  onClick: () => onMoveDown(block.id),
                },
              ]}
            />
          )}
        </div>

        {showInsertMenu === 'above' && (
          <AddBlockMenu
            onAdd={(type) => { onInsertBefore(block.id, type); setShowInsertMenu(null); }}
            onClose={() => {
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
            position="above"
          />
        )}

        {showInsertMenu === 'below' && (
          <AddBlockMenu
            onAdd={(type) => { onInsertAfter(block.id, type); setShowInsertMenu(null); }}
            onClose={() => {
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
            position="below"
          />
        )}
      </ActionPanel>
    </div>
  );
}, function areBlockItemPropsEqual(prev, next) {
  if (prev.block !== next.block) return false;
  if (prev.canMoveUp !== next.canMoveUp || prev.canMoveDown !== next.canMoveDown) return false;
  if (prev.shouldFocus !== next.shouldFocus) return false;
  if (prev.selectionKey !== next.selectionKey) return false;
  if (prev.rowBindingsKey !== next.rowBindingsKey) return false;
  if (prev.imageMetaKey !== next.imageMetaKey) return false;
  if (prev.annotationsKey !== next.annotationsKey) return false;
  if (prev.mermaidMetaKey !== next.mermaidMetaKey) return false;
  if (prev.mindmapMetaKey !== next.mindmapMetaKey) return false;
  if (prev.maxFirstLineIndentLevel !== next.maxFirstLineIndentLevel) return false;
  const prevActive = prev.activeActionBlockId === prev.block.id;
  const nextActive = next.activeActionBlockId === next.block.id;
  if (prevActive !== nextActive) return false;
  const prevMenu = prev.activeInsertMenuOwnerId === prev.block.id;
  const nextMenu = next.activeInsertMenuOwnerId === next.block.id;
  if (prevMenu !== nextMenu) return false;
  if (prev.onCopyMdCursorRef !== next.onCopyMdCursorRef) return false;
  return true;
});
