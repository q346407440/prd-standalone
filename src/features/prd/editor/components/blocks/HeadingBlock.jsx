import { getHeadingFontSize } from '../../prd-utils.js';
import { TiptapMarkdownEditor } from '../../TiptapMarkdownEditor.jsx';

export function HeadingBlock({
  block, onUpdate, globalSelection, setGlobalSelection,
  onEnter, onBackspaceEmpty, setFocusBlockId, onEditingFinished,
}) {
  const tag = block.type;
  const fontSize = getHeadingFontSize(tag);
  const text = block.content?.markdown ?? block.content?.text ?? '';
  return (
    <div className={`prd-block-heading prd-block-heading--${tag}`} style={{ fontSize }} data-prd-no-block-select>
      <TiptapMarkdownEditor
        value={text}
        onSave={(v) => onUpdate({ ...block, content: { type: 'text', markdown: v } })}
        placeholder={`${tag.toUpperCase()} 标题`}
        blockId={block.id}
        selectionRole="heading"
        globalSelection={globalSelection}
        setGlobalSelection={setGlobalSelection}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
        onEditingFinished={onEditingFinished}
        blockLevel={block.type}
        singleLine
        onBlockLevelChange={(nextType, t) => {
          onUpdate({ ...block, type: nextType, content: { type: 'text', markdown: t } });
          setFocusBlockId?.(block.id);
        }}
      />
    </div>
  );
}
