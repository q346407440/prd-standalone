import { memo } from 'react';
import { EMPTY_BLOCK_PERF_KEYS } from '../prd-constants.js';
import { BlockItem } from './BlockItem.jsx';
import { AddAtEndButton } from './AddAtEndButton.jsx';
import { computeFirstLineIndentCeiling } from '../prd-list-utils.js';

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
        // 当前 block 首行允许的最大 indent level：依赖上一个 block 是否为 paragraph(text)
        // 及其末行 list level。非 paragraph / 首个 block / paragraph-image 前置时返回 0，
        // 意味着编辑器 Tab 不能把首行缩进到非零层（阻止产生「孤儿缩进」写法）。
        const prevBlock = index > 0 ? blocks[index - 1] : null;
        const prevParagraphMd = (prevBlock?.type === 'paragraph' && prevBlock?.content?.type !== 'image')
          ? (prevBlock.content?.markdown || '')
          : null;
        const maxFirstLineIndentLevel = computeFirstLineIndentCeiling(prevParagraphMd);
        return (
          <BlockItem
            key={block.id}
            block={block}
            maxFirstLineIndentLevel={maxFirstLineIndentLevel}
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
            onBackspaceMergeBlock={callbacks.onBackspaceMergeBlock}
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
            prdAssetCacheBust={sidecarState.prdAssetCacheBust}
            onCopyMdCursorRef={callbacks.onCopyMdCursorRef}
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
