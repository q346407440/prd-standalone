import { MINDMAP_BLOCK_DEFAULT_WIDTH } from '../../prd-constants.js';
import { mindmapCodeToMetaKey } from '../../prd-perf-keys.js';
import { MindmapRenderer } from '../renderers/MindmapRenderer.jsx';

export function MindmapBlock({
  block, onUpdate, mindmapMeta, onMindmapMetaChange,
}) {
  const metaKey = mindmapCodeToMetaKey(block.content?.code);
  const viewMode = mindmapMeta?.mindmapViewModes?.[metaKey] || 'code';
  const widthPx = mindmapMeta?.mindmapWidths?.[metaKey] ?? MINDMAP_BLOCK_DEFAULT_WIDTH;

  return (
    <div className="prd-block-mindmap" data-prd-no-block-select>
      <MindmapRenderer
        code={block.content?.code || ''}
        onCodeChange={(newCode) => onUpdate({ ...block, content: { type: 'mindmap', code: newCode } })}
        viewMode={viewMode}
        onViewModeChange={(mode) => onMindmapMetaChange?.('mindmapViewModes', metaKey, mode)}
        widthPx={widthPx}
        onWidthChange={(w) => onMindmapMetaChange?.('mindmapWidths', metaKey, w)}
        resizable
      />
    </div>
  );
}
