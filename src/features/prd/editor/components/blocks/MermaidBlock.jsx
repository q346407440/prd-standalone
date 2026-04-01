import { MERMAID_BLOCK_DEFAULT_WIDTH } from '../../prd-constants.js';
import { mermaidCodeToMetaKey } from '../../prd-perf-keys.js';
import { MermaidRenderer } from '../renderers/MermaidRenderer.jsx';

export function MermaidBlock({
  block, onUpdate, mermaidMeta, onMermaidMetaChange,
}) {
  const metaKey = mermaidCodeToMetaKey(block.content?.code);
  const viewMode = mermaidMeta?.mermaidViewModes?.[metaKey] || 'code';
  const widthPx = mermaidMeta?.mermaidWidths?.[metaKey] ?? MERMAID_BLOCK_DEFAULT_WIDTH;

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
