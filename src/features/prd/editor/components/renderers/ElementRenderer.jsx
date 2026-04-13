import { memo } from 'react';
import { TiptapMarkdownEditor } from '../../TiptapMarkdownEditor.jsx';
import { MermaidRenderer } from './MermaidRenderer.jsx';
import { MindmapRenderer } from './MindmapRenderer.jsx';
import { ImageRenderer } from './ImageRenderer.jsx';
import { inferListPrefix } from '../../prd-list-utils.js';
import { DEFAULT_DIAGRAM_VIEW_MODE } from '../../prd-constants.js';

export function hasOwnEnterField(payload, key) {
  return !!payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, key);
}

export function getEnterCurrentMarkdown(payload) {
  if (typeof payload === 'string') return payload;
  if (hasOwnEnterField(payload, 'currentMarkdown')) return payload.currentMarkdown ?? '';
  return undefined;
}

export function hasExplicitEnterNextMarkdown(payload) {
  return hasOwnEnterField(payload, 'nextMarkdown');
}

export function getEnterNextMarkdown(payload) {
  if (typeof payload === 'string') return inferListPrefix(payload) ?? '';
  if (hasExplicitEnterNextMarkdown(payload)) return payload.nextMarkdown ?? '';
  const currentMarkdown = getEnterCurrentMarkdown(payload);
  return currentMarkdown ? (inferListPrefix(currentMarkdown) ?? '') : '';
}

export const ElementRenderer = memo(function ElementRenderer({
  element,
  onUpdate,
  onDelete,
  blockId,
  cellPath = null,
  isPreviewSelected = false,
  isImageSelected = false,
  setGlobalSelection,
  onEnter,
  onBackspaceEmpty,
  onBackspaceMerge,
  onPasteImageAsBlock,
  onReplaceWithImage,
  onImageWidthChange,
  imageMeta,
  placeholder,
  onEditingFinished,
  blockType,
  onBlockLevelChange,
  onAnnotate,
  annotationCount = 0,
  prdAssetCacheBust = 0,
  onResetOrderedStart,
  mermaidViewMode,
  onMermaidViewModeChange,
  mindmapViewMode,
  onMindmapViewModeChange,
}) {
  if (!element || element.type === 'text') {
    const isInCell = cellPath != null;
    return (
      <TiptapMarkdownEditor
        blockId={blockId}
        cellPath={cellPath}
        isPreviewSelected={isPreviewSelected}
        setGlobalSelection={setGlobalSelection}
        value={element?.markdown ?? ''}
        onSave={(v) => onUpdate({ type: 'text', markdown: v })}
        placeholder={placeholder || '点击此处填写内容（支持 Markdown）'}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
        onBackspaceMerge={onBackspaceMerge}
        onPasteImageAsBlock={onPasteImageAsBlock}
        onReplaceWithImage={onReplaceWithImage ?? ((src) => onUpdate({ type: 'image', src }))}
        onEditingFinished={onEditingFinished}
        blockLevel={isInCell ? undefined : blockType}
        onBlockLevelChange={isInCell ? undefined : onBlockLevelChange}
        onResetOrderedStart={onResetOrderedStart}
      />
    );
  }

  if (element.type === 'image') {
    return (
      <ImageRenderer
        element={element}
        onUpdate={onUpdate}
        onDelete={() => {
          setGlobalSelection?.(null);
          onDelete();
        }}
        isSelected={isImageSelected}
        onSelect={() => setGlobalSelection?.({ type: 'image', blockId, cellPath })}
        initialWidthPx={imageMeta?.[element.src] ?? null}
        onWidthChange={(w) => onImageWidthChange?.(element.src, w)}
        onEnter={onEnter}
        onAnnotate={onAnnotate}
        annotationCount={annotationCount}
        prdAssetCacheBust={prdAssetCacheBust}
      />
    );
  }

  if (element.type === 'mermaid') {
    return (
      <div className="prd-cell-mermaid-wrap">
        <MermaidRenderer
          code={element.code || ''}
          onCodeChange={(newCode) => onUpdate({ type: 'mermaid', code: newCode })}
          viewMode={mermaidViewMode || 'code'}
          onViewModeChange={onMermaidViewModeChange}
          resizable={false}
        />
      </div>
    );
  }

  if (element.type === 'mindmap') {
    return (
      <div className="prd-cell-mindmap-wrap">
        <MindmapRenderer
          code={element.code || ''}
          onCodeChange={(newCode) => onUpdate({ type: 'mindmap', code: newCode })}
          viewMode={mindmapViewMode || DEFAULT_DIAGRAM_VIEW_MODE}
          onViewModeChange={onMindmapViewModeChange}
          resizable={false}
        />
      </div>
    );
  }

  return null;
});
