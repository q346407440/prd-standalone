import { MINDMAP_BLOCK_DEFAULT_WIDTH } from '../../prd-constants.js';
import {
  mindmapStandaloneMetaKey,
  resolveMindmapViewMode,
  resolveMindmapWidth,
} from '../../prd-perf-keys.js';
import { MindmapRenderer } from '../renderers/MindmapRenderer.jsx';

export function MindmapBlock({
  block, onUpdate, mindmapMeta, onMindmapMetaChange, isSelected = false, onSelect,
}) {
  const placement = { kind: 'standalone', blockId: block.id };
  const viewMode = resolveMindmapViewMode(mindmapMeta, block.content?.code, placement);
  const widthPx = resolveMindmapWidth(mindmapMeta, block.content?.code, placement, MINDMAP_BLOCK_DEFAULT_WIDTH);
  const metaKey = mindmapStandaloneMetaKey(block.id);

  return (
    <div className="prd-block-mindmap">
      <MindmapRenderer
        code={block.content?.code || ''}
        onCodeChange={(newCode) => onUpdate({ ...block, content: { type: 'mindmap', code: newCode } })}
        viewMode={viewMode}
        onViewModeChange={(mode) => onMindmapMetaChange?.('mindmapViewModes', metaKey, mode)}
        widthPx={widthPx}
        isSelected={isSelected}
        onSelect={onSelect}
      />
    </div>
  );
}
