import { ElementRenderer } from '../renderers/ElementRenderer.jsx';
import { ParagraphLinesEditor } from './ParagraphLinesEditor.jsx';
import { markdownNeedsLineSplitEditing } from '../../prd-list-utils.js';

export function ParagraphBlock({
  block, onUpdate, globalSelection, setGlobalSelection,
  onEnter, onBackspaceEmpty, onBackspaceMerge, onPasteImageAsBlock,
  imageMeta, onImageWidthChange, prdAssetCacheBust = 0, setFocusBlockId,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  onEditingFinished,
  onResetOrderedStart,
  maxFirstLineIndentLevel = 0,
  onParagraphActiveRowForCopyChange,
}) {
  const content = block.content ?? { type: 'text', markdown: '' };
  const mdText = content.type === 'text' ? (content.markdown ?? '') : '';
  const useLinesEditor = content.type === 'text' && markdownNeedsLineSplitEditing(mdText);

  const isPreviewSelected = globalSelection?.type === 'text-block'
    && globalSelection.blockId === block.id
    && globalSelection.role === 'paragraph'
    && globalSelection.cellPath == null;
  const isImageSelected = globalSelection?.type === 'image'
    && globalSelection.blockId === block.id
    && globalSelection.cellPath == null;

  if (useLinesEditor) {
    return (
      <div className="prd-block-paragraph" data-prd-no-block-select>
        <ParagraphLinesEditor
          markdown={mdText}
          onSave={(newMd) => onUpdate({ ...block, content: { type: 'text', markdown: newMd } })}
          blockId={block.id}
          globalSelection={globalSelection}
          setGlobalSelection={setGlobalSelection}
          onBackspaceEmpty={onBackspaceEmpty}
          onPasteImageAsBlock={onPasteImageAsBlock}
          onEditingFinished={onEditingFinished}
          placeholder="点击此处填写段落文字（支持 Markdown）"
          blockType={block.type}
          onBlockLevelChange={(nextType, md) => {
            onUpdate({ ...block, type: nextType, content: { type: 'text', markdown: md } });
            setFocusBlockId?.(block.id);
          }}
          onResetOrderedStart={onResetOrderedStart}
          maxFirstLineIndentLevel={maxFirstLineIndentLevel}
          onParagraphActiveRowForCopyChange={onParagraphActiveRowForCopyChange}
        />
      </div>
    );
  }

  return (
    <div className="prd-block-paragraph" data-prd-no-block-select>
      <ElementRenderer
        element={content}
        globalSelection={globalSelection}
        maxIndentLevel={maxFirstLineIndentLevel}
        onUpdate={(newEl) => onUpdate({ ...block, content: newEl })}
        onDelete={() => onUpdate({ ...block, content: { type: 'text', markdown: '' } })}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        blockId={block.id}
        isPreviewSelected={isPreviewSelected}
        isImageSelected={isImageSelected}
        setGlobalSelection={setGlobalSelection}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
        onBackspaceMerge={onBackspaceMerge}
        onPasteImageAsBlock={onPasteImageAsBlock}
        imageMeta={imageMeta}
        onImageWidthChange={onImageWidthChange}
        prdAssetCacheBust={prdAssetCacheBust}
        onEditingFinished={onEditingFinished}
        placeholder="点击此处填写段落文字（支持 Markdown）"
        blockType={block.type}
        onBlockLevelChange={(nextType, md) => {
          onUpdate({ ...block, type: nextType, content: { type: 'text', markdown: md } });
          setFocusBlockId?.(block.id);
        }}
        onResetOrderedStart={onResetOrderedStart}
      />
    </div>
  );
}
