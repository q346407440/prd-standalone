import { MERMAID_BLOCK_DEFAULT_WIDTH } from '../../prd-constants.js';
import {
  mermaidStandaloneMetaKey,
  resolveMermaidViewMode,
  resolveMermaidWidth,
} from '../../prd-perf-keys.js';
import { MermaidRenderer } from '../renderers/MermaidRenderer.jsx';

export function MermaidBlock({
  block, onUpdate, mermaidMeta, onMermaidMetaChange,
}) {
  const placement = { kind: 'standalone', blockId: block.id };
  const viewMode = resolveMermaidViewMode(mermaidMeta, block.content?.code, placement);
  const widthPx = resolveMermaidWidth(mermaidMeta, block.content?.code, placement, MERMAID_BLOCK_DEFAULT_WIDTH);
  const metaKey = mermaidStandaloneMetaKey(block.id);

  return (
    <div className="prd-block-mermaid" data-prd-no-block-select>
      <MermaidRenderer
        code={block.content?.code || ''}
        onCodeChange={(newCode) => onUpdate({ ...block, content: { type: 'mermaid', code: newCode } })}
        viewMode={viewMode}
        onViewModeChange={(mode) => onMermaidMetaChange?.('mermaidViewModes', metaKey, mode)}
        widthPx={widthPx}
        onWidthChange={(w) => onMermaidMetaChange?.('mermaidWidths', metaKey, w)}
        resizable
      />
    </div>
  );
}
