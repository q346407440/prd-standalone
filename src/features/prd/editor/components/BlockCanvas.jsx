import { memo } from 'react';
import { EMPTY_BLOCK_PERF_KEYS } from '../prd-constants.js';
import { BlockItem } from './BlockItem.jsx';
import { AddAtEndButton } from './AddAtEndButton.jsx';

const EMPTY_ROW_BINDINGS = [];

export const BlockCanvas = memo(function BlockCanvas({
  blocks,
  blockUiState,
  selectionState,
  sidecarState,
  annotationState,
  rowBindingsByBlock,
  blockPerfKeysById,
  callbacks,
}) {
  return (
    <main className="prd-page__main">
      {blocks.map((block, index) => {
        const perfKeys = blockPerfKeysById.get(block.id) || EMPTY_BLOCK_PERF_KEYS;
        return (
          <BlockItem
            key={block.id}
            block={block}
            onUpdate={callbacks.onUpdate}
            onDelete={callbacks.onDelete}
            onDuplicate={callbacks.onDuplicate}
            onInsertBefore={callbacks.onInsertBefore}
            onInsertAfter={callbacks.onInsertAfter}
            onMoveUp={callbacks.onMoveUp}
            onMoveDown={callbacks.onMoveDown}
            canMoveUp={index > 0}
            canMoveDown={index < blocks.length - 1}
            activeActionBlockId={blockUiState.activeActionBlockId}
            requestActionbarOpen={blockUiState.requestActionbarOpen}
            requestActionbarClose={blockUiState.requestActionbarClose}
            keepActionbarOpen={blockUiState.keepActionbarOpen}
            clearActionbarState={blockUiState.clearActionbarState}
            activeInsertMenuOwnerId={blockUiState.activeInsertMenuOwnerId}
            openInsertMenu={blockUiState.openInsertMenu}
            closeInsertMenu={blockUiState.closeInsertMenu}
            selectionKey={perfKeys.selectionKey}
            rowBindingsKey={perfKeys.rowBindingsKey}
            imageMetaKey={perfKeys.imageMetaKey}
            annotationsKey={perfKeys.annotationsKey}
            mermaidMetaKey={perfKeys.mermaidMetaKey}
            mindmapMetaKey={perfKeys.mindmapMetaKey}
            globalSelection={selectionState.globalSelection}
            setGlobalSelection={selectionState.setGlobalSelection}
            shouldFocus={blockUiState.focusBlockId === block.id}
            onFocusConsumed={blockUiState.clearFocusBlockId}
            onEnterBlock={callbacks.onEnterBlock}
            onBackspaceEmptyBlock={callbacks.onBackspaceEmptyBlock}
            onPasteImageAsBlockBlock={callbacks.onPasteImageAsBlockBlock}
            imageMeta={sidecarState.imageMeta}
            onImageWidthChange={sidecarState.onImageWidthChange}
            setFocusBlockId={blockUiState.setFocusBlockId}
            registerBlockRef={blockUiState.registerBlockRef}
            onEditingFinishedBlock={blockUiState.onEditingFinishedBlock}
            rowBindings={rowBindingsByBlock.get(block.id) || EMPTY_ROW_BINDINGS}
            annotationsDoc={annotationState.annotationsDoc}
            onAnnotateUsage={annotationState.onAnnotateUsage}
            onSetCellChangeIntent={annotationState.onSetCellChangeIntent}
            onSetCellPendingConfirm={annotationState.onSetCellPendingConfirm}
            onSetCellPendingConfirmNote={annotationState.onSetCellPendingConfirmNote}
            onCellEdited={annotationState.onCellEdited}
            onResetOrderedStartBlock={annotationState.onResetOrderedStartBlock}
            mermaidMeta={sidecarState.mermaidMeta}
            onMermaidMetaChange={sidecarState.onMermaidMetaChange}
            mindmapMeta={sidecarState.mindmapMeta}
            onMindmapMetaChange={sidecarState.onMindmapMetaChange}
          />
        );
      })}

      <AddAtEndButton
        onAdd={callbacks.onAddAtEnd}
        activeInsertMenuOwnerId={blockUiState.activeInsertMenuOwnerId}
        openInsertMenu={blockUiState.openInsertMenu}
        closeInsertMenu={blockUiState.closeInsertMenu}
      />
    </main>
  );
});
