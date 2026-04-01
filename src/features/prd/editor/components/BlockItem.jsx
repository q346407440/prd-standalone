import { memo, useCallback, useEffect, useRef, useState } from 'react';
import { nodeContainsTarget } from '../prd-utils.js';
import { ActionPanel } from './FloatingActionBubble.jsx';
import { AddBlockMenu } from './AddBlockMenu.jsx';
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
  globalSelection, setGlobalSelection,
  shouldFocus, onFocusConsumed,
  onEnterBlock, onBackspaceEmptyBlock, onPasteImageAsBlockBlock,
  imageMeta, onImageWidthChange,
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
}) {
  const [showInsertMenu, setShowInsertMenu] = useState(null);
  const suppressActionbarUntilLeaveRef = useRef(false);
  const rootRef = useRef(null);
  const hasGlobalSelection = globalSelection != null;
  const insertMenuOwnerId = block.id;

  useEffect(() => {
    if (activeInsertMenuOwnerId === insertMenuOwnerId) return;
    setShowInsertMenu(null);
  }, [activeInsertMenuOwnerId, insertMenuOwnerId]);

  const openActionbar = () => {
    if (hasGlobalSelection) return;
    if (suppressActionbarUntilLeaveRef.current) return;
    requestActionbarOpen(block.id);
  };

  const closeActionbarWithDelay = () => {
    requestActionbarClose(block.id);
    setShowInsertMenu(null);
    closeInsertMenu(insertMenuOwnerId);
  };

  const closeActionbarImmediately = useCallback(() => {
    requestActionbarClose(block.id, { immediate: true });
    setShowInsertMenu(null);
    closeInsertMenu(insertMenuOwnerId);
  }, [block.id, closeInsertMenu, insertMenuOwnerId, requestActionbarClose]);

  const handleEnter = useCallback((md) => {
    onEnterBlock(block.id, md, block.type);
  }, [onEnterBlock, block.id, block.type]);

  const handleBackspaceEmpty = useCallback(() => {
    onBackspaceEmptyBlock(block.id);
  }, [onBackspaceEmptyBlock, block.id]);

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
    if (activeActionBlockId !== block.id || hasGlobalSelection || suppressActionbarUntilLeaveRef.current) return undefined;
    const handlePointerOutside = (event) => {
      if (nodeContainsTarget(rootRef.current, event.target)) return;
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
  }, [activeActionBlockId, block.id, closeActionbarImmediately, hasGlobalSelection]);

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
            onPasteImageAsBlock={handlePasteImageAsBlock}
            imageMeta={imageMeta}
            onImageWidthChange={onImageWidthChange}
            setFocusBlockId={setFocusBlockId}
            onEditingFinished={handleEditingFinished}
            onMoveUp={() => onMoveUp(block.id)}
            onMoveDown={() => onMoveDown(block.id)}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onResetOrderedStart={onResetOrderedStartBlock ? (newMd, startNum) => onResetOrderedStartBlock(block.id, newMd, startNum) : undefined}
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
      className={[
        'prd-block-item',
        (activeActionBlockId === block.id || showInsertMenu != null) ? 'prd-block-item--action-active' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={openActionbar}
      onMouseLeave={() => {
        suppressActionbarUntilLeaveRef.current = false;
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
          && !hasGlobalSelection
          && !suppressActionbarUntilLeaveRef.current
          && !(globalSelection && globalSelection.blockId === block.id)
        }
        className="prd-block-actionbar"
        onMouseEnter={() => {
          keepActionbarOpen(block.id);
        }}
        onMouseLeave={closeActionbarWithDelay}
      >
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => onDuplicate(block.id)}
        >
          复制
        </button>
        <button
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => {
            const next = showInsertMenu === 'above' ? null : 'above';
            setShowInsertMenu(next);
            if (next) openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
            else closeInsertMenu(insertMenuOwnerId);
          }}
        >
          上方插入
        </button>
        <button
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => {
            const next = showInsertMenu === 'below' ? null : 'below';
            setShowInsertMenu(next);
            if (next) openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
            else closeInsertMenu(insertMenuOwnerId);
          }}
        >
          下方插入
        </button>
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          disabled={!canMoveUp}
          title="上移"
          onClick={() => onMoveUp(block.id)}
        >
          上移
        </button>
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          disabled={!canMoveDown}
          title="下移"
          onClick={() => onMoveDown(block.id)}
        >
          下移
        </button>
        <button
          className="prd-action-btn prd-action-btn--danger prd-block-actionbar__btn prd-block-actionbar__btn--delete"
          onClick={() => onDelete(block.id)}
        >
          删除
        </button>

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
  const prevActive = prev.activeActionBlockId === prev.block.id;
  const nextActive = next.activeActionBlockId === next.block.id;
  if (prevActive !== nextActive) return false;
  const prevMenu = prev.activeInsertMenuOwnerId === prev.block.id;
  const nextMenu = next.activeInsertMenuOwnerId === next.block.id;
  if (prevMenu !== nextMenu) return false;
  return true;
});
