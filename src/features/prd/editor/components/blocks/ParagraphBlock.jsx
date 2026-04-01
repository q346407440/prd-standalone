import { ElementRenderer } from '../renderers/ElementRenderer.jsx';

export function ParagraphBlock({
  block, onUpdate, globalSelection, setGlobalSelection,
  onEnter, onBackspaceEmpty, onPasteImageAsBlock,
  imageMeta, onImageWidthChange, setFocusBlockId,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  onEditingFinished,
  onResetOrderedStart,
}) {
  const content = block.content ?? { type: 'text', markdown: '' };
  return (
    <div className="prd-block-paragraph" data-prd-no-block-select>
      <ElementRenderer
        element={content}
        onUpdate={(newEl) => onUpdate({ ...block, content: newEl })}
        onDelete={() => onUpdate({ ...block, content: { type: 'text', markdown: '' } })}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        blockId={block.id}
        globalSelection={globalSelection}
        setGlobalSelection={setGlobalSelection}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
        onPasteImageAsBlock={onPasteImageAsBlock}
        imageMeta={imageMeta}
        onImageWidthChange={onImageWidthChange}
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
