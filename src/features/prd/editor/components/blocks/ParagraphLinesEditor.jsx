import {
  useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { TiptapMarkdownEditor } from '../../TiptapMarkdownEditor.jsx';
import { computeLineIndentCeiling } from '../../prd-list-utils.js';

/**
 * 段落 block 多行编辑器。
 *
 * 磁盘模型不变（仍是单串 `block.content.markdown`，以 `\n` 分行）。
 * 在 runtime 把 markdown 按 `\n` 拆成行数组，每行一个独立的 TiptapMarkdownEditor——
 * 与表格 CellRenderer 里的 elements[] 模型对齐：
 *   - Enter: 当前行在光标处拆分为 currentMarkdown / nextMarkdown，下方插入一行并聚焦。
 *   - Backspace on empty line: 删除当前行；只剩一行时委托给 onBackspaceEmpty（整块删除）。
 *   - Tab / Shift+Tab: 由每行内部 TiptapMarkdownEditor 处理 prefix indent。
 *   - 保存: lines.join('\n') 回写到 onSave。
 *
 * 行级选中态由内部 activeLineIdx 维护，仅高亮被点击的那一行；
 * 对外 globalSelection 仍以 block 为粒度，不污染其他消费者。
 */
let uidSeed = 0;
const makeUid = () => `pl-${Date.now().toString(36)}-${(uidSeed += 1).toString(36)}`;

function splitMdIntoLines(md) {
  if (!md) return [''];
  return md.split('\n');
}

/** 主文档段落 cellPath 为 null；表格格内文本与 globalSelection.cellPath 对齐 */
function matchesParagraphSelectionCellPath(selPath, editorCellPath) {
  const want = editorCellPath ?? null;
  const got = selPath ?? null;
  if (want === null) return got === null;
  if (!got) return false;
  return got.ri === want.ri && got.ci === want.ci && got.idx === want.idx;
}

export function ParagraphLinesEditor({
  markdown,
  onSave,
  blockId,
  /** 表格单元格 `{ ri, ci, idx }`；主文档段落不传 */
  cellPath,
  globalSelection,
  setGlobalSelection,
  onBackspaceEmpty,
  /** 仅第一行：与上一段落块 / 上一格内元素合并（见 CellRenderer） */
  onBackspaceMerge,
  onPasteImageAsBlock,
  onEditingFinished,
  placeholder,
  blockType,
  onBlockLevelChange,
  onResetOrderedStart,
  maxFirstLineIndentLevel = 0,
  /** 多行段落内当前高亮行（0-based），供「复制路径与片段」落到当前行 */
  onParagraphActiveRowForCopyChange,
}) {
  const lines = useMemo(() => splitMdIntoLines(markdown), [markdown]);

  /** 每行对应的稳定 uid，供 React key 使用；随 lines 长度同步扩缩，内容变化不重建。 */
  const [uids, setUids] = useState(() => lines.map(() => makeUid()));
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 外部 markdown 被覆写导致 lines 长度变化时（磁盘同步 / 撤销），同步补齐 uid；本组件自己的 add/remove 走 state 直接更新。
    setUids((prev) => {
      if (prev.length === lines.length) return prev;
      if (prev.length < lines.length) {
        const diff = lines.length - prev.length;
        const added = Array.from({ length: diff }, () => makeUid());
        return [...prev, ...added];
      }
      return prev.slice(0, lines.length);
    });
  }, [lines.length]);

  const [focusIdx, setFocusIdx] = useState(null);
  const [activeLineIdx, setActiveLineIdx] = useState(null);
  const containerRefs = useRef({});

  useEffect(() => {
    if (focusIdx == null) return;
    const node = containerRefs.current[focusIdx];
    if (!node) return;
    const el = node.querySelector('.prd-editable-md--preview, textarea, input, [contenteditable]');
    if (el) {
      el.click?.();
      el.focus?.();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 新增行后用 focusIdx 触发一次性 DOM 聚焦，随即清回 null；不同步 React state，属单向 DOM 调度
    setFocusIdx(null);
  }, [focusIdx, lines.length]);

  /** 当 block/格内元素选中态切出、markdown 外部覆写时，重置行级高亮 */
  useEffect(() => {
    const pathOk = matchesParagraphSelectionCellPath(globalSelection?.cellPath, cellPath);
    if (globalSelection?.blockId !== blockId || !pathOk) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- globalSelection 来自外部 context；block 失焦后需清掉行级高亮，属单向同步
      setActiveLineIdx(null);
      onParagraphActiveRowForCopyChange?.(null);
    }
  }, [blockId, cellPath, globalSelection, onParagraphActiveRowForCopyChange]);

  const updateLine = useCallback((idx, newLineMd) => {
    const next = lines.map((l, i) => (i === idx ? newLineMd : l));
    onSave(next.join('\n'));
  }, [lines, onSave]);

  const addLineAfter = useCallback((idx, payload) => {
    const currentMd = payload?.currentMarkdown ?? lines[idx] ?? '';
    const nextMd = payload?.nextMarkdown ?? '';
    const nextLines = [
      ...lines.slice(0, idx),
      currentMd,
      nextMd,
      ...lines.slice(idx + 1),
    ];
    setUids((prev) => [
      ...prev.slice(0, idx + 1),
      makeUid(),
      ...prev.slice(idx + 1),
    ]);
    onSave(nextLines.join('\n'));
    setActiveLineIdx(idx + 1);
    setFocusIdx(idx + 1);
    onParagraphActiveRowForCopyChange?.(idx + 1);
    setGlobalSelection?.({
      type: 'text-block',
      blockId,
      role: 'paragraph',
      cellPath: cellPath ?? null,
    });
  }, [blockId, cellPath, lines, onParagraphActiveRowForCopyChange, onSave, setGlobalSelection]);

  const removeLine = useCallback((idx) => {
    if (lines.length <= 1) {
      onBackspaceEmpty?.();
      return;
    }
    const nextLines = lines.filter((_, i) => i !== idx);
    setUids((prev) => prev.filter((_, i) => i !== idx));
    onSave(nextLines.join('\n'));
    const focusTarget = Math.max(0, idx - 1);
    setActiveLineIdx(focusTarget);
    setFocusIdx(focusTarget);
    onParagraphActiveRowForCopyChange?.(focusTarget);
  }, [lines, onBackspaceEmpty, onSave, onParagraphActiveRowForCopyChange]);

  const isBlockSelected = globalSelection?.type === 'text-block'
    && globalSelection.blockId === blockId
    && globalSelection.role === 'paragraph'
    && matchesParagraphSelectionCellPath(globalSelection.cellPath, cellPath);

  const handleLineMouseDown = useCallback((idx) => {
    setActiveLineIdx(idx);
    onParagraphActiveRowForCopyChange?.(idx);
  }, [onParagraphActiveRowForCopyChange]);

  return (
    <div className="prd-paragraph-lines">
      {lines.map((lineMd, idx) => {
        const isPreviewSelected = isBlockSelected && activeLineIdx === idx;
        const isFirstLine = idx === 0;
        // 每行允许的最大 indent level：首行受「前一 block 末行 level + 1」约束（外部传入），
        // 非首行受「本 block 内前一非空行 level + 1」约束。Tab 超过时编辑器不响应。
        const lineMaxIndent = computeLineIndentCeiling(markdown, idx, maxFirstLineIndentLevel);
        return (
          <div
            key={uids[idx]}
            className="prd-paragraph-lines__row"
            ref={(node) => {
              if (node) containerRefs.current[idx] = node;
              else delete containerRefs.current[idx];
            }}
            onMouseDownCapture={() => handleLineMouseDown(idx)}
          >
            <TiptapMarkdownEditor
              blockId={blockId}
              cellPath={cellPath}
              value={lineMd}
              onSave={(v) => updateLine(idx, v)}
              onEnter={(payload) => addLineAfter(idx, payload)}
              onBackspaceEmpty={() => removeLine(idx)}
              onBackspaceMerge={isFirstLine ? onBackspaceMerge : undefined}
              onPasteImageAsBlock={onPasteImageAsBlock}
              placeholder={isFirstLine ? placeholder : ''}
              isPreviewSelected={isPreviewSelected}
              setGlobalSelection={setGlobalSelection}
              onEditingFinished={onEditingFinished}
              blockLevel={isFirstLine ? blockType : undefined}
              onBlockLevelChange={isFirstLine ? onBlockLevelChange : undefined}
              onResetOrderedStart={onResetOrderedStart}
              maxIndentLevel={lineMaxIndent}
            />
          </div>
        );
      })}
    </div>
  );
}
