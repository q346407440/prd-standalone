import { ElementRenderer } from '../renderers/ElementRenderer.jsx';
import { ParagraphLinesEditor } from './ParagraphLinesEditor.jsx';

/**
 * 判断段落 block 的 markdown 是否需要走「多行拆分」编辑路径：
 * - 含 `\n`（同一 block 内多行内容）
 * - 不含代码围栏 ```（围栏跨行时按 \n 硬拆会破坏结构，fallback 单串）
 *
 * 载入阶段 `expandParagraphBlocksOnBlankLines` 已把含空行的段落拆成多个 block，
 * 因此能到这里的多行 md 都是「单换行连续列表」场景（最典型：嵌套 `- / - / ...`）。
 */
function paragraphMarkdownIsMultiLine(md) {
  if (!md) return false;
  if (md.includes('```')) return false;
  return md.includes('\n');
}

export function ParagraphBlock({
  block, onUpdate, globalSelection, setGlobalSelection,
  onEnter, onBackspaceEmpty, onBackspaceMerge, onPasteImageAsBlock,
  imageMeta, onImageWidthChange, prdAssetCacheBust = 0, setFocusBlockId,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  onEditingFinished,
  onResetOrderedStart,
  maxFirstLineIndentLevel = 0,
}) {
  const content = block.content ?? { type: 'text', markdown: '' };
  const mdText = content.type === 'text' ? (content.markdown ?? '') : '';
  const useLinesEditor = content.type === 'text' && paragraphMarkdownIsMultiLine(mdText);

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
        />
      </div>
    );
  }

  return (
    <div className="prd-block-paragraph" data-prd-no-block-select>
      <ElementRenderer
        element={content}
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
