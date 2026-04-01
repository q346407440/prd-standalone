import {
  Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import '../../../shared/styles/prd-table.css';
import '../../../shared/styles/prd-section.css';
import './styles/prd.css';
import './styles/prd-annotations.css';
import './styles/prd-overview.css';
import './styles/prd-page-edit.css';
import { parsePrd } from './prd-parser';
import { serializePrd } from './prd-writer';
import { emitPrdToast, PRD_TOAST_EVENT } from './prd-toast.js';
import {
  buildStandalonePrdExport,
  downloadStandalonePrdExport,
  saveStandalonePrdExportToDirectory,
} from './prd-export.js';
import {
  isEmptyOrderedListMd,
} from './prd-list-utils.js';
import { buildCropBase64, buildFocusBase64, loadImageElement } from './prd-annotation-images.js';
import { measurePrdTask, recordPrdInteraction } from './prd-performance.js';
import {
  buildDerivedAssetNames,
  buildTableBindings,
  createEmptyAnnotationsDoc,
  getUsageRegions,
  markCellSource,
  mergeAnnotationSettingsWithLocalStorage,
  normalizeAnnotationsDoc,
  persistRegionFormDefaultsFromRegions,
  reconcileAnnotationsWithBlocks,
  setCellChangeIntent,
  setCellPendingConfirm,
  setCellPendingConfirmNote,
  updateAssetMetadata,
  updateUsageMetadata,
  upsertDerivedAsset,
  upsertUsageRegions,
} from './prd-annotations.js';
import {
  DEFAULT_PRD_SLUG,
  TOC_OPEN_STORAGE_KEY,
  PERSIST_DEBOUNCE_MS,
  TOAST_EXIT_MS,
  ACTIONBAR_OPEN_DELAY_MS,
  ACTIONBAR_SWITCH_DELAY_MS,
  ACTIONBAR_CLOSE_DELAY_MS,
  PRD_EVENTS_API,
} from './prd-constants.js';
import {
  slugToMdPath,
  genId,
  diffRemovedPrdPaths,
  isNodeHovered,
} from './prd-utils.js';
import {
  fetchPrdMd,
  savePrdMd,
  fetchPrdMeta,
  savePrdMeta,
  fetchPrdAnnotations,
  savePrdAnnotations,
  saveAnnotationAsset,
  deleteAnnotationAsset,
  deletePrdImage,
  fetchActiveDoc,
} from './prd-api.js';
import {
  readPersistedViewportSnapshot,
  persistViewportSnapshot,
  reconcileLoadedBlockIds,
  captureViewportSnapshot,
  restoreViewportSnapshot,
} from './prd-viewport-snapshot.js';
import {
  makeDefaultBlock,
  cloneBlockWithNewId,
  makePrdSectionTemplateBlocks,
  normalizeLegacyBlocks,
  setBlockMd,
  isMainDocTextListBlock,
  renumberMainDocTextListAt,
  renumberMainDocTextListFrom,
  maybeRenumberMainDocTextListAt,
} from './prd-block-operations.js';
import {
  getBlockSelectionPerfKey,
  getRowBindingsPerfKey,
  getBlockImageMetaPerfKey,
  getBlockMermaidMetaPerfKey,
  getBlockMindmapMetaPerfKey,
  getTableAnnotationsPerfKey,
} from './prd-perf-keys.js';
import { renderMermaidSvgForExport } from './components/renderers/MermaidRenderer.jsx';
import { renderMindmapSvgForExport } from './components/renderers/MindmapRenderer.jsx';
import {
  getEnterCurrentMarkdown,
  getEnterNextMarkdown,
  hasExplicitEnterNextMarkdown,
} from './components/renderers/ElementRenderer.jsx';
import { BlockCanvas } from './components/BlockCanvas.jsx';
import { OutlineSidebar } from './components/OutlineSidebar.jsx';
import { PrdToolbar } from './components/PrdToolbar.jsx';
import { DeleteConfirmModal } from './components/modals/DeleteConfirmModal.jsx';
import { ToastViewport } from './components/ToastViewport.jsx';

const EMPTY_ANNOTATIONS_DOC = createEmptyAnnotationsDoc();
const EMPTY_MERMAID_META = { mermaidViewModes: {}, mermaidWidths: {} };
const EMPTY_MINDMAP_META = { mindmapViewModes: {}, mindmapWidths: {} };

const PrdAnnotationModalLazy = lazy(() => import('./PrdAnnotationModal.jsx').then((mod) => ({
  default: mod.PrdAnnotationModal,
})));

const EMPTY_ROW_BINDINGS = [];

let _toastSeq = 0;


// ─── 主頁面 ──────────────────────────────────────────────────────────────────

export function PrdPage() {
  const [activeSlug, setActiveSlug] = useState(DEFAULT_PRD_SLUG);
  const activeSlugRef = useRef(DEFAULT_PRD_SLUG);
  const activeMdPathRef = useRef(slugToMdPath(DEFAULT_PRD_SLUG));
  const [blocks, setBlocks] = useState(null);
  const [loadErr, setLoadErr] = useState('');
  const [toasts, setToasts] = useState([]);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [activeActionBlockId, setActiveActionBlockId] = useState(null);
  const [activeInsertMenuOwnerId, setActiveInsertMenuOwnerId] = useState(null);
  const activeActionBlockIdRef = useRef(null);
  const activeInsertMenuOwnerIdRef = useRef(null);
  const actionbarOpenTimerRef = useRef(null);
  const actionbarCloseTimerRef = useRef(null);
  const pendingActionbarBlockIdRef = useRef(null);
  /** 全局唯一 UI 选中（文本 / 表格 / 链接等）；与 Block 操作条互斥 */
  const [globalSelection, setGlobalSelection] = useState(null);
  /** Enter 新增 Block 後要聚焦的 blockId */
  const [focusBlockId, setFocusBlockId] = useState(null);
  const [isTocOpen, setIsTocOpen] = useState(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem(TOC_OPEN_STORAGE_KEY) === '1';
  });
  const [activeTocId, setActiveTocId] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  /** 图片宽度 sidecar：{ [imgSrc]: widthPx }，存 prd.meta.json */
  const [imageMeta, setImageMeta] = useState({});
  const imageMetaRef = useRef({});
  const metaDebounceRef = useRef(null);
  const [mermaidMeta, setMermaidMeta] = useState({ mermaidViewModes: {}, mermaidWidths: {} });
  const mermaidMetaRef = useRef({ mermaidViewModes: {}, mermaidWidths: {} });
  const [mindmapMeta, setMindmapMeta] = useState({ mindmapViewModes: {}, mindmapWidths: {} });
  const mindmapMetaRef = useRef({ mindmapViewModes: {}, mindmapWidths: {} });
  const [annotationsDoc, setAnnotationsDoc] = useState(createEmptyAnnotationsDoc());
  const annotationsRef = useRef(createEmptyAnnotationsDoc());
  const annotationsReadyRef = useRef(false);
  const [annotationModalState, setAnnotationModalState] = useState(null);
  /** 上次成功写入磁盘的 md 全文，用于对比 /prd/ 引用以删除孤儿图片 */
  const lastSavedMdRef = useRef('');
  const blocksRef = useRef(null);
  const persistDebounceRef = useRef(null);
  const persistRunningRef = useRef(false);
  const persistQueuedBlocksRef = useRef(null);
  const hasPendingLocalChangesRef = useRef(false);
  const hasExternalMdConflictRef = useRef(false);
  const viewportPersistTimerRef = useRef(null);
  const toastTimersRef = useRef(new Map());
  const blockRefs = useRef({});
  const contentScrollRef = useRef(null);
  const pendingViewportRestoreRef = useRef(null);
  const tocScrollFrameRef = useRef(null);
  const tocUpdateStampRef = useRef(0);
  const pendingTocTargetRef = useRef(null);
  const autoCreatedOrderedSeedIdsRef = useRef(new Set());
  const clearFocusBlockId = useCallback(() => setFocusBlockId(null), []);
  const clearAutoCreatedOrderedSeed = useCallback((blockId) => {
    if (!blockId) return;
    autoCreatedOrderedSeedIdsRef.current.delete(blockId);
  }, []);

  const clearPendingActionbarOpen = useCallback((blockId = null) => {
    if (blockId != null && pendingActionbarBlockIdRef.current !== blockId) return;
    if (actionbarOpenTimerRef.current) clearTimeout(actionbarOpenTimerRef.current);
    actionbarOpenTimerRef.current = null;
    if (blockId == null || pendingActionbarBlockIdRef.current === blockId) {
      pendingActionbarBlockIdRef.current = null;
    }
  }, []);

  const clearPendingActionbarClose = useCallback(() => {
    if (actionbarCloseTimerRef.current) clearTimeout(actionbarCloseTimerRef.current);
    actionbarCloseTimerRef.current = null;
  }, []);

  const clearActionbarState = useCallback(() => {
    clearPendingActionbarOpen();
    clearPendingActionbarClose();
    setActiveActionBlockId(null);
  }, [clearPendingActionbarOpen, clearPendingActionbarClose]);

  const closeInsertMenu = useCallback((ownerId = null) => {
    if (ownerId != null && activeInsertMenuOwnerIdRef.current !== ownerId) return;
    setActiveInsertMenuOwnerId(null);
  }, []);

  const openInsertMenu = useCallback((ownerId, { preserveActionbarBlockId = null } = {}) => {
    clearPendingActionbarOpen();
    clearPendingActionbarClose();
    setGlobalSelection(null);
    setActiveInsertMenuOwnerId(ownerId);
    if (preserveActionbarBlockId != null) setActiveActionBlockId(preserveActionbarBlockId);
    else setActiveActionBlockId(null);
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl !== document.body) {
      activeEl.blur();
    }
  }, [clearPendingActionbarClose, clearPendingActionbarOpen]);

  const requestActionbarOpen = useCallback((blockId, { immediate = false } = {}) => {
    if (!blockId) return;
    if (activeInsertMenuOwnerIdRef.current != null && activeActionBlockIdRef.current !== blockId) return;
    clearPendingActionbarClose();
    const activeId = activeActionBlockIdRef.current;
    if (activeId === blockId) {
      clearPendingActionbarOpen(blockId);
      return;
    }
    const delay = immediate ? 0 : activeId ? ACTIONBAR_SWITCH_DELAY_MS : ACTIONBAR_OPEN_DELAY_MS;
    clearPendingActionbarOpen();
    pendingActionbarBlockIdRef.current = blockId;
    const activate = () => {
      if (pendingActionbarBlockIdRef.current !== blockId) return;
      const blockNode = blockRefs.current[blockId];
      if (!isNodeHovered(blockNode) && activeInsertMenuOwnerIdRef.current !== blockId) {
        pendingActionbarBlockIdRef.current = null;
        actionbarOpenTimerRef.current = null;
        return;
      }
      pendingActionbarBlockIdRef.current = null;
      actionbarOpenTimerRef.current = null;
      recordPrdInteraction('hover-actionbar-open', { blockId, delay });
      setActiveActionBlockId(blockId);
    };
    if (delay === 0) {
      activate();
      return;
    }
    actionbarOpenTimerRef.current = setTimeout(activate, delay);
  }, [clearPendingActionbarClose, clearPendingActionbarOpen]);

  const requestActionbarClose = useCallback((blockId, { immediate = false } = {}) => {
    if (!blockId) return;
    clearPendingActionbarOpen(blockId);
    clearPendingActionbarClose();
    const close = () => {
      actionbarCloseTimerRef.current = null;
      setActiveActionBlockId((curr) => (curr === blockId ? null : curr));
    };
    if (immediate) {
      close();
      return;
    }
    actionbarCloseTimerRef.current = setTimeout(close, ACTIONBAR_CLOSE_DELAY_MS);
  }, [clearPendingActionbarClose, clearPendingActionbarOpen]);

  const keepActionbarOpen = useCallback((blockId) => {
    if (!blockId) return;
    if (activeInsertMenuOwnerIdRef.current != null && activeActionBlockIdRef.current !== blockId) return;
    clearPendingActionbarOpen();
    clearPendingActionbarClose();
    if (activeActionBlockIdRef.current !== blockId) {
      setActiveActionBlockId(blockId);
    }
  }, [clearPendingActionbarClose, clearPendingActionbarOpen]);

  const clearUiSelection = useCallback(() => {
    setGlobalSelection(null);
    closeInsertMenu();
    clearActionbarState();
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl !== document.body) {
      activeEl.blur();
    }
  }, [clearActionbarState, closeInsertMenu]);

  useEffect(() => {
    blocksRef.current = blocks;
  }, [blocks]);

  const saveViewportSnapshot = useCallback(() => {
    const snapshot = captureViewportSnapshot(
      blocksRef.current,
      blockRefs.current,
      contentScrollRef.current,
    );
    persistViewportSnapshot(snapshot, activeSlugRef.current);
  }, []);

  const scheduleViewportSnapshotPersist = useCallback(() => {
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current);
    viewportPersistTimerRef.current = setTimeout(() => {
      viewportPersistTimerRef.current = null;
      saveViewportSnapshot();
    }, 140);
  }, [saveViewportSnapshot]);

  useLayoutEffect(() => {
    if (!blocks?.length) return;
    const snapshot = pendingViewportRestoreRef.current;
    if (!snapshot) return;
    const container = contentScrollRef.current;
    if (!container) return;
    restoreViewportSnapshot(snapshot, blocks, blockRefs.current, container);
    pendingViewportRestoreRef.current = null;
  }, [blocks]);

  useEffect(() => () => {
    if (viewportPersistTimerRef.current) clearTimeout(viewportPersistTimerRef.current);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const handlePageHide = () => {
      if (viewportPersistTimerRef.current) {
        clearTimeout(viewportPersistTimerRef.current);
        viewportPersistTimerRef.current = null;
      }
      saveViewportSnapshot();
    };
    window.addEventListener('pagehide', handlePageHide);
    return () => {
      window.removeEventListener('pagehide', handlePageHide);
    };
  }, [saveViewportSnapshot]);

  useEffect(() => {
    activeActionBlockIdRef.current = activeActionBlockId;
  }, [activeActionBlockId]);

  useEffect(() => {
    activeInsertMenuOwnerIdRef.current = activeInsertMenuOwnerId;
  }, [activeInsertMenuOwnerId]);

  useEffect(() => () => {
    clearPendingActionbarOpen();
    clearPendingActionbarClose();
  }, [clearPendingActionbarClose, clearPendingActionbarOpen]);

  const tableBindings = useMemo(
    () => (blocks ? buildTableBindings(blocks) : { rows: [], usages: [] }),
    [blocks],
  );
  const rowBindingsByBlock = useMemo(() => {
    const grouped = new Map();
    const usageMap = new Map(
      annotationsDoc.usages.map((usage) => [usage.usageId, usage])
    );
    tableBindings.rows.forEach((row) => {
      const current = grouped.get(row.blockId) || [];
      current[row.rowIndex] = {
        ...row,
        usages: tableBindings.usages
          .filter((usage) => usage.rowKey === row.rowKey)
          .map((usage) => ({ ...usage, ...(usageMap.get(usage.usageId) || {}) })),
      };
      grouped.set(row.blockId, current);
    });
    return grouped;
  }, [annotationsDoc.usages, tableBindings.rows, tableBindings.usages]);

  const blockPerfKeysById = useMemo(() => measurePrdTask('build-block-perf-keys', () => {
    const grouped = new Map();
    const nextBlocks = blocks || [];
    for (const block of nextBlocks) {
      const rowBindings = rowBindingsByBlock.get(block.id) || EMPTY_ROW_BINDINGS;
      grouped.set(block.id, {
        selectionKey: getBlockSelectionPerfKey(block, globalSelection),
        rowBindingsKey: block.type === 'table' ? getRowBindingsPerfKey(rowBindings) : '',
        imageMetaKey: getBlockImageMetaPerfKey(block, imageMeta),
        annotationsKey: block.type === 'table' ? getTableAnnotationsPerfKey(rowBindings, annotationsDoc) : '',
        mermaidMetaKey: getBlockMermaidMetaPerfKey(block, mermaidMeta),
        mindmapMetaKey: getBlockMindmapMetaPerfKey(block, mindmapMeta),
      });
    }
    return grouped;
  }, { blockCount: blocks?.length || 0 }), [blocks, rowBindingsByBlock, globalSelection, imageMeta, annotationsDoc, mermaidMeta, mindmapMeta]);

  const commitAnnotationsDoc = useCallback(async (nextDoc, cleanupPaths = []) => {
    annotationsRef.current = nextDoc;
    setAnnotationsDoc(nextDoc);
    if (cleanupPaths.length) {
      await Promise.all(cleanupPaths.map((path) => deleteAnnotationAsset(path).catch(() => {})));
    }
    await savePrdAnnotations(nextDoc, activeSlugRef.current);
  }, []);

  useEffect(() => {
    if (!blocks || !annotationsReadyRef.current) return;
    const prevSerialized = JSON.stringify(annotationsRef.current);
    const { doc: reconciled, removedDerivedPaths } = reconcileAnnotationsWithBlocks(annotationsRef.current, blocks);
    const nextSerialized = JSON.stringify(reconciled);
    if (prevSerialized === nextSerialized && removedDerivedPaths.length === 0) return;
    void commitAnnotationsDoc(reconciled, removedDerivedPaths);
  }, [blocks, commitAnnotationsDoc]);

  const handleOpenAnnotationModal = useCallback((usage) => {
    if (!usage?.sourceImageSrc) return;
    setAnnotationModalState({ usage });
  }, []);

  const handleSaveUsageAnnotations = useCallback(async (usage, regions, imageInfo, usagePatch = {}) => {
    let nextDoc = updateAssetMetadata(annotationsRef.current, usage.sourceImageSrc, {
      width: imageInfo?.naturalWidth || 0,
      height: imageInfo?.naturalHeight || 0,
      mimeType: imageInfo?.mimeType || 'image/png',
      status: 'active',
    });
    nextDoc = updateUsageMetadata(nextDoc, usage.usageId, usagePatch);
    const previousDerived = nextDoc.derivedAssets.filter((item) => item.usageId === usage.usageId);
    const nextRegionIds = new Set(regions.map((region) => region.regionId));
    const cleanupPaths = previousDerived
      .filter((item) => !nextRegionIds.has(item.regionId))
      .flatMap((item) => [item.focusSrc, item.cropSrc].filter(Boolean));

    nextDoc = upsertUsageRegions(nextDoc, usage.usageId, regions);
    if (regions.length) {
      const image = await loadImageElement(usage.sourceImageSrc);
      for (const region of regions) {
        const names = buildDerivedAssetNames(usage.usageId, region.regionId);
        const focusBase64 = buildFocusBase64(image, region.bbox, region.label || region.title || region.regionId);
        const cropBase64 = buildCropBase64(image, region.bbox);
        await saveAnnotationAsset(names.focusFileName, focusBase64);
        await saveAnnotationAsset(names.cropFileName, cropBase64);
        nextDoc = upsertDerivedAsset(nextDoc, {
          derivedId: `derived-${region.regionId}`,
          usageId: usage.usageId,
          regionId: region.regionId,
          focusSrc: names.focusSrc,
          cropSrc: names.cropSrc,
          status: 'active',
        });
      }
    }
    await commitAnnotationsDoc(nextDoc, cleanupPaths);
    persistRegionFormDefaultsFromRegions(
      regions,
      normalizeAnnotationsDoc(nextDoc).settings,
    );
    setAnnotationModalState(null);
  }, [commitAnnotationsDoc]);

  const handleSetCellChangeIntent = useCallback((rowKey, usageId, columnKey, changeIntent) => {
    const nextDoc = setCellChangeIntent(
      annotationsRef.current,
      rowKey,
      usageId,
      columnKey,
      changeIntent,
    );
    void commitAnnotationsDoc(nextDoc);
  }, [commitAnnotationsDoc]);

  const handleSetCellPendingConfirm = useCallback((rowKey, usageId, columnKey, pendingConfirm) => {
    const nextDoc = setCellPendingConfirm(
      annotationsRef.current,
      rowKey,
      usageId,
      columnKey,
      pendingConfirm,
    );
    void commitAnnotationsDoc(nextDoc);
  }, [commitAnnotationsDoc]);

  const handleSetCellPendingConfirmNote = useCallback((rowKey, usageId, columnKey, note) => {
    const nextDoc = setCellPendingConfirmNote(
      annotationsRef.current,
      rowKey,
      usageId,
      columnKey,
      note,
    );
    void commitAnnotationsDoc(nextDoc);
  }, [commitAnnotationsDoc]);

  const handleMarkCellManual = useCallback((rowKey, usageId, columnKey) => {
    const nextDoc = markCellSource(annotationsRef.current, rowKey, usageId, columnKey, 'manual');
    annotationsRef.current = nextDoc;
    setAnnotationsDoc(nextDoc);
    void savePrdAnnotations(nextDoc, activeSlugRef.current);
  }, []);

  useEffect(() => {
    if (globalSelection == null) return;
    closeInsertMenu();
    clearActionbarState();
  }, [clearActionbarState, closeInsertMenu, globalSelection]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(TOC_OPEN_STORAGE_KEY, isTocOpen ? '1' : '0');
  }, [isTocOpen]);

  const toggleToc = useCallback(() => setIsTocOpen((prev) => !prev), []);

  const clearToastTimers = useCallback((id) => {
    const timers = toastTimersRef.current.get(id);
    if (!timers) return;
    if (timers.dismissTimer) clearTimeout(timers.dismissTimer);
    if (timers.removeTimer) clearTimeout(timers.removeTimer);
    if (timers.enterFrame) cancelAnimationFrame(timers.enterFrame);
    toastTimersRef.current.delete(id);
  }, []);

  const dismissToast = useCallback((id) => {
    setToasts((prev) => prev.map((toast) => (
      toast.id === id ? { ...toast, visible: false } : toast
    )));
    const timers = toastTimersRef.current.get(id) || {};
    if (timers.removeTimer) clearTimeout(timers.removeTimer);
    timers.removeTimer = setTimeout(() => {
      setToasts((prev) => prev.filter((toast) => toast.id !== id));
      clearToastTimers(id);
    }, TOAST_EXIT_MS);
    toastTimersRef.current.set(id, timers);
  }, [clearToastTimers]);

  const showToast = useCallback(({
    id,
    message,
    tone = 'success',
    duration = 1800,
  }) => {
    if (!message) return;
    const toastId = id || `prd-toast-${Date.now()}-${++_toastSeq}`;
    clearToastTimers(toastId);
    setToasts((prev) => {
      const nextToast = { id: toastId, message, tone, visible: false };
      const existingIndex = prev.findIndex((toast) => toast.id === toastId);
      if (existingIndex >= 0) {
        const next = [...prev];
        next[existingIndex] = nextToast;
        return next;
      }
      return [...prev, nextToast];
    });
    const timers = {};
    timers.enterFrame = requestAnimationFrame(() => {
      setToasts((prev) => prev.map((toast) => (
        toast.id === toastId ? { ...toast, visible: true } : toast
      )));
    });
    if (duration != null) {
      timers.dismissTimer = setTimeout(() => dismissToast(toastId), duration);
    }
    toastTimersRef.current.set(toastId, timers);
  }, [clearToastTimers, dismissToast]);

  useEffect(() => {
    const onToast = (e) => {
      const nextMessage = e.detail?.message;
      if (!nextMessage) return;
      showToast({
        id: e.detail?.id,
        message: nextMessage,
        tone: e.detail?.tone ?? 'success',
        duration: e.detail?.duration ?? 1800,
      });
    };
    window.addEventListener(PRD_TOAST_EVENT, onToast);
    return () => {
      window.removeEventListener(PRD_TOAST_EVENT, onToast);
      for (const id of toastTimersRef.current.keys()) {
        clearToastTimers(id);
      }
    };
  }, [clearToastTimers, showToast]);

  const applyLoadedPrdMd = useCallback((mdText, { preserveViewport = false, restoreSnapshot = null } = {}) => {
    if (preserveViewport) {
      pendingViewportRestoreRef.current = captureViewportSnapshot(
        blocksRef.current,
        blockRefs.current,
        contentScrollRef.current,
      );
    } else if (restoreSnapshot) {
      pendingViewportRestoreRef.current = restoreSnapshot;
    } else {
      pendingViewportRestoreRef.current = null;
    }
    lastSavedMdRef.current = mdText;
    hasPendingLocalChangesRef.current = false;
    hasExternalMdConflictRef.current = false;
    setLoadErr('');
    const parsedBlocks = normalizeLegacyBlocks(parsePrd(mdText));
    setBlocks(reconcileLoadedBlockIds(blocksRef.current, parsedBlocks));
  }, []);

  const refreshPrdMdFromDisk = useCallback(async ({ showSyncedToast = false } = {}) => {
    const md = await fetchPrdMd(activeMdPathRef.current);
    if (md === lastSavedMdRef.current) return false;
    applyLoadedPrdMd(md, { preserveViewport: true });
    if (showSyncedToast) {
      showToast({
        id: 'prd-live-sync',
        message: '检测到文档已更新，已自动同步到编辑器',
        tone: 'success',
        duration: 1800,
      });
    }
    return true;
  }, [applyLoadedPrdMd, showToast]);

  // 實際寫盤（可排隊，避免並發覆蓋）
  const runPersistAsync = useCallback(async (nextBlocks) => {
    if (persistRunningRef.current) {
      persistQueuedBlocksRef.current = nextBlocks;
      return;
    }
    persistRunningRef.current = true;
    try {
      let toSave = nextBlocks;
      while (toSave) {
        persistQueuedBlocksRef.current = null;
        showToast({
          id: 'persist-status',
          message: '保存中…',
          tone: 'warning',
          duration: null,
        });
        const newMd = serializePrd(toSave);
        const oldMd = lastSavedMdRef.current;
        if (newMd === oldMd) {
          hasPendingLocalChangesRef.current = false;
          showToast({
            id: 'persist-status',
            message: '已保存',
            tone: 'success',
            duration: 1800,
          });
          toSave = persistQueuedBlocksRef.current;
          continue;
        }
        try {
          const latestMd = await fetchPrdMd(activeMdPathRef.current);
          if (latestMd !== oldMd) {
            lastSavedMdRef.current = latestMd;
            showToast({
              id: 'persist-status',
              message: '检测到文档已被外部更新，正在合并保存…',
              tone: 'warning',
              duration: 1800,
            });
          }
          const removed = diffRemovedPrdPaths(lastSavedMdRef.current, newMd);
          for (const p of removed) {
            await deletePrdImage(p).catch(() => {});
          }
          await savePrdMd(newMd, activeSlugRef.current);
          lastSavedMdRef.current = newMd;
          hasPendingLocalChangesRef.current = false;
          hasExternalMdConflictRef.current = false;
          showToast({
            id: 'persist-status',
            message: '已保存',
            tone: 'success',
            duration: 1800,
          });
        } catch {
          hasPendingLocalChangesRef.current = false;
          showToast({
            id: 'persist-status',
            message: '保存失败（请确认 dev server 正在运行）',
            tone: 'error',
            duration: 2600,
          });
          break;
        }
        toSave = persistQueuedBlocksRef.current;
      }
    } finally {
      persistRunningRef.current = false;
    }
  }, [showToast]);

  const schedulePersist = useCallback(() => {
    hasPendingLocalChangesRef.current = true;
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
    persistDebounceRef.current = setTimeout(() => {
      persistDebounceRef.current = null;
      const toSave = blocksRef.current;
      if (toSave) void runPersistAsync(toSave);
    }, PERSIST_DEBOUNCE_MS);
  }, [runPersistAsync]);

  useEffect(() => () => {
    if (persistDebounceRef.current) clearTimeout(persistDebounceRef.current);
  }, []);

  // 初次載入（先获取 active-doc，再并行加载 md/meta/annotations）
  useEffect(() => {
    fetchActiveDoc().then(({ slug, mdPath }) => {
      activeSlugRef.current = slug;
      activeMdPathRef.current = mdPath;
      setActiveSlug(slug);
      fetchPrdMd(mdPath)
        .then((md) => applyLoadedPrdMd(md, { restoreSnapshot: readPersistedViewportSnapshot(slug) }))
        .catch((e) => setLoadErr(e.message));
      fetchPrdMeta(slug)
        .then((meta) => {
          imageMetaRef.current = meta;
          setImageMeta(meta);
          const mm = {
            mermaidViewModes: meta.mermaidViewModes || {},
            mermaidWidths: meta.mermaidWidths || {},
          };
          mermaidMetaRef.current = mm;
          setMermaidMeta(mm);
          const mindmapM = {
            mindmapViewModes: meta.mindmapViewModes || {},
            mindmapWidths: meta.mindmapWidths || {},
          };
          mindmapMetaRef.current = mindmapM;
          setMindmapMeta(mindmapM);
        });
      fetchPrdAnnotations(slug)
        .then((doc) => {
          const normalized = normalizeAnnotationsDoc(doc);
          annotationsRef.current = normalized;
          annotationsReadyRef.current = true;
          setAnnotationsDoc(normalized);
        });
    });
  }, [applyLoadedPrdMd]);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.EventSource === 'undefined') return undefined;
    const source = new window.EventSource(PRD_EVENTS_API);
    const handleMdChanged = () => {
      if (hasPendingLocalChangesRef.current || persistRunningRef.current) {
        showToast({
          id: 'prd-live-sync',
          message: '检测到文档已被外部更新，当前编辑内容将在保存时覆盖',
          tone: 'warning',
          duration: 2400,
        });
        return;
      }
      void refreshPrdMdFromDisk({ showSyncedToast: true }).catch((e) => {
        showToast({
          id: 'prd-live-sync',
          message: `同步文档失败：${e?.message || e}`,
          tone: 'error',
          duration: 2600,
        });
      });
    };
    source.addEventListener('md-changed', handleMdChanged);
    return () => {
      source.removeEventListener('md-changed', handleMdChanged);
      source.close();
    };
  }, [refreshPrdMdFromDisk, showToast]);

  const debounceSaveMeta = useCallback(() => {
    if (metaDebounceRef.current) clearTimeout(metaDebounceRef.current);
    metaDebounceRef.current = setTimeout(() => {
      metaDebounceRef.current = null;
      void savePrdMeta({
        ...imageMetaRef.current,
        ...mermaidMetaRef.current,
        ...mindmapMetaRef.current,
      }, activeSlugRef.current);
    }, 800);
  }, []);

  // 图片宽度变更：更新 state + debounce 写盘
  const handleImageWidthChange = useCallback((src, widthPx) => {
    const next = { ...imageMetaRef.current, [src]: widthPx };
    imageMetaRef.current = next;
    setImageMeta(next);
    debounceSaveMeta();
  }, [debounceSaveMeta]);

  const handleMermaidMetaChange = useCallback((section, key, value) => {
    const nextMm = {
      ...mermaidMetaRef.current,
      [section]: { ...mermaidMetaRef.current[section], [key]: value },
    };
    mermaidMetaRef.current = nextMm;
    setMermaidMeta(nextMm);
    debounceSaveMeta();
  }, [debounceSaveMeta]);

  const handleMindmapMetaChange = useCallback((section, key, value) => {
    const nextMm = {
      ...mindmapMetaRef.current,
      [section]: { ...mindmapMetaRef.current[section], [key]: value },
    };
    mindmapMetaRef.current = nextMm;
    setMindmapMeta(nextMm);
    debounceSaveMeta();
  }, [debounceSaveMeta]);

  // 更新單個 Block；有序列表時自動重新編號
  const handleUpdate = useCallback((updatedBlock) => {
    setBlocks((prev) => {
      let next = prev.map((b) => (b.id === updatedBlock.id ? updatedBlock : b));
      autoCreatedOrderedSeedIdsRef.current.delete(updatedBlock.id);

      if (isMainDocTextListBlock(updatedBlock)) {
        const idx = next.findIndex((b) => b.id === updatedBlock.id);
        if (idx >= 0) next = maybeRenumberMainDocTextListAt(next, idx);
      }
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  // 刪除（先彈確認）
  const handleDeleteRequest = useCallback((id) => {
    setDeleteTarget(id);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    if (!deleteTarget) return;
    clearAutoCreatedOrderedSeed(deleteTarget);
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === deleteTarget);
      if (idx < 0) return prev;
      let next = prev.filter((b) => b.id !== deleteTarget);
      const neighborIdx = Math.min(idx, next.length - 1);
      if (neighborIdx >= 0) next = maybeRenumberMainDocTextListAt(next, neighborIdx);
      return next;
    });
    setDeleteTarget(null);
    schedulePersist();
  }, [clearAutoCreatedOrderedSeed, deleteTarget, schedulePersist]);

  // 在某 Block 後插入新 Block
  const handleInsertAfter = useCallback((afterId, type) => {
    const newBlocks = type === 'prd-section-template' ? makePrdSectionTemplateBlocks() : [makeDefaultBlock(type)];
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === afterId);
      const next = [...prev.slice(0, idx + 1), ...newBlocks, ...prev.slice(idx + 1)];
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  const handleDuplicateBlock = useCallback((blockId) => {
    let duplicatedBlockId = null;
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx < 0) return prev;
      const duplicated = cloneBlockWithNewId(prev[idx]);
      duplicatedBlockId = duplicated.id;
      let next = [...prev.slice(0, idx + 1), duplicated, ...prev.slice(idx + 1)];
      next = maybeRenumberMainDocTextListAt(next, idx + 1);
      return next;
    });
    if (duplicatedBlockId) setFocusBlockId(duplicatedBlockId);
    schedulePersist();
  }, [schedulePersist]);

  // 在某 Block 前插入新 Block
  const handleInsertBefore = useCallback((beforeId, type) => {
    const newBlocks = type === 'prd-section-template' ? makePrdSectionTemplateBlocks() : [makeDefaultBlock(type)];
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === beforeId);
      const insertAt = Math.max(0, idx);
      const next = [...prev.slice(0, insertAt), ...newBlocks, ...prev.slice(insertAt)];
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  // 在頁面末尾插入新 Block
  const handleAddAtEnd = useCallback((type) => {
    const newBlocks = type === 'prd-section-template' ? makePrdSectionTemplateBlocks() : [makeDefaultBlock(type)];
    setBlocks((prev) => [...prev, ...newBlocks]);
    schedulePersist();
  }, [schedulePersist]);

  // Enter 鍵：文本 block 繼承自身類型；列表前綴則按當前項推導下一項序號。
  const handleEnterBlock = useCallback((afterId, enterPayload, sourceType = 'paragraph') => {
    const currentMarkdown = getEnterCurrentMarkdown(enterPayload);
    const nextMarkdown = getEnterNextMarkdown(enterPayload);
    const shouldUseExplicitNextMarkdown = hasExplicitEnterNextMarkdown(enterPayload) || !!nextMarkdown;
    const shouldInheritType = /^h[1-7]$/.test(sourceType) || sourceType === 'paragraph';
    const newBlock = makeDefaultBlock(shouldInheritType ? sourceType : 'paragraph');
    if (shouldUseExplicitNextMarkdown && newBlock.content?.type === 'text') {
      newBlock.content = { type: 'text', markdown: nextMarkdown };
    }
    if (isEmptyOrderedListMd(nextMarkdown)) {
      autoCreatedOrderedSeedIdsRef.current.add(newBlock.id);
    } else {
      clearAutoCreatedOrderedSeed(newBlock.id);
    }
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === afterId);
      if (idx < 0) return prev;
      let next = [...prev];
      if (currentMarkdown !== undefined && isMainDocTextListBlock(next[idx])) {
        next[idx] = setBlockMd(next[idx], currentMarkdown);
      }
      next.splice(idx + 1, 0, newBlock);
      next = renumberMainDocTextListAt(next, idx + 1);
      return next;
    });
    setFocusBlockId(newBlock.id);
    schedulePersist();
  }, [clearAutoCreatedOrderedSeed, schedulePersist]);

  // 在 afterId block 後插入 image block（段落貼圖時觸發）
  const handlePasteImageAsBlock = useCallback((afterId, imageSrc) => {
    const newBlock = { id: genId(), type: 'paragraph', content: { type: 'image', src: imageSrc } };
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === afterId);
      const next = [...prev.slice(0, idx + 1), newBlock, ...prev.slice(idx + 1)];
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  // Backspace 空 Block：刪除並聚焦上一個 block，然後重編號
  const handleBackspaceEmpty = useCallback((id) => {
    clearAutoCreatedOrderedSeed(id);
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx <= 0) return prev;
      const prevBlock = prev[idx - 1];
      setFocusBlockId(prevBlock.id);
      let next = prev.filter((b) => b.id !== id);
      const neighborIdx = Math.min(idx, next.length - 1);
      if (neighborIdx >= 0) next = maybeRenumberMainDocTextListAt(next, neighborIdx);
      return next;
    });
    schedulePersist();
  }, [clearAutoCreatedOrderedSeed, schedulePersist]);

  const handleResetOrderedStart = useCallback((blockId, newMd, startNum) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === blockId);
      if (idx < 0) return prev;
      const block = prev[idx];
      const updatedBlock = { ...block, content: { ...block.content, markdown: newMd } };
      let next = prev.map((b, i) => i === idx ? updatedBlock : b);
      next = renumberMainDocTextListFrom(next, idx, startNum);
      return next;
    });
    schedulePersist();
  }, [schedulePersist]);

  const renumberAroundIndex = (blocks, idx) => {
    return maybeRenumberMainDocTextListAt(blocks, idx);
  };

  const handleMoveUp = useCallback((id) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx <= 0) return prev;
      const next = [...prev];
      [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
      return renumberAroundIndex(renumberAroundIndex(next, idx - 1), idx);
    });
    schedulePersist();
  }, [schedulePersist]);

  const handleMoveDown = useCallback((id) => {
    setBlocks((prev) => {
      const idx = prev.findIndex((b) => b.id === id);
      if (idx < 0 || idx >= prev.length - 1) return prev;
      const next = [...prev];
      [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
      return renumberAroundIndex(renumberAroundIndex(next, idx), idx + 1);
    });
    schedulePersist();
  }, [schedulePersist]);

  const tocItems = useMemo(() => (
    (blocks || [])
      .filter((block) => /^h[1-7]$/.test(block.type))
      .map((block) => ({
        id: block.id,
        level: Number(block.type.slice(1)),
        title: (block.content?.markdown || block.content?.text || '').trim() || '未命名标题',
      }))
  ), [blocks]);

  const registerBlockRef = useCallback((blockId, node) => {
    if (node) blockRefs.current[blockId] = node;
    else delete blockRefs.current[blockId];
  }, []);

  const updateActiveTocByScroll = useCallback(() => {
    const container = contentScrollRef.current;
    if (!container || !tocItems.length) return;
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - tocUpdateStampRef.current < 72) return;
    tocUpdateStampRef.current = now;
    measurePrdTask('toc-scroll-sync', () => {
      const activationLine = container.scrollTop + Math.min(Math.max(container.clientHeight * 0.22, 96), 180);
      const pendingTarget = pendingTocTargetRef.current;
      if (pendingTarget) {
        const targetNode = blockRefs.current[pendingTarget.id];
        const isExpired = (
          typeof performance !== 'undefined'
          && performance.now() > pendingTarget.expiresAt
        );
        const nodeTop = targetNode?.offsetTop ?? null;
        const isReached = nodeTop != null
          ? Math.abs(nodeTop - activationLine) <= 18 || nodeTop <= activationLine
          : false;
        if (!targetNode || isExpired || isReached) {
          pendingTocTargetRef.current = null;
        } else {
          setActiveTocId((prev) => (prev === pendingTarget.id ? prev : pendingTarget.id));
          return;
        }
      }
      let nextActiveId = tocItems[0]?.id ?? null;
      for (const item of tocItems) {
        const node = blockRefs.current[item.id];
        if (!node) continue;
        if (node.offsetTop <= activationLine) nextActiveId = item.id;
        else break;
      }
      setActiveTocId((prev) => (prev === nextActiveId ? prev : nextActiveId));
    }, { headingCount: tocItems.length });
  }, [tocItems]);

  useEffect(() => {
    setActiveTocId((prev) => {
      if (!tocItems.length) return null;
      if (prev && tocItems.some((item) => item.id === prev)) return prev;
      return tocItems[0].id;
    });
    updateActiveTocByScroll();
  }, [tocItems, updateActiveTocByScroll]);

  useEffect(() => {
    const container = contentScrollRef.current;
    if (!container) return undefined;
    const onScroll = () => {
      if (tocScrollFrameRef.current != null) return;
      tocScrollFrameRef.current = requestAnimationFrame(() => {
        tocScrollFrameRef.current = null;
        updateActiveTocByScroll();
        scheduleViewportSnapshotPersist();
      });
    };
    container.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => {
      container.removeEventListener('scroll', onScroll);
      if (tocScrollFrameRef.current != null) {
        cancelAnimationFrame(tocScrollFrameRef.current);
        tocScrollFrameRef.current = null;
      }
    };
  }, [updateActiveTocByScroll, scheduleViewportSnapshotPersist]);

  const handleTocItemClick = useCallback((blockId) => {
    const node = blockRefs.current[blockId];
    if (!node) return;
    pendingTocTargetRef.current = {
      id: blockId,
      expiresAt: (typeof performance !== 'undefined' ? performance.now() : Date.now()) + 1400,
    };
    setActiveTocId(blockId);
    node.scrollIntoView({ behavior: 'smooth', block: 'start', inline: 'nearest' });
  }, []);

  const handleExportStandalone = useCallback(async ({ currentTitle = '', archiveName = '' } = {}) => {
    if (!blocks?.length || isExporting) return;
    setIsExporting(true);
    emitPrdToast('正在导出离线包…', {
      id: 'prd-export',
      tone: 'warning',
      duration: null,
    });
    try {
      const exported = await buildStandalonePrdExport({
        title: currentTitle || activeSlugRef.current,
        archiveName,
        blocks,
        activeSlug: activeSlugRef.current,
        mdPath: activeMdPathRef.current,
        imageMeta,
        mermaidMeta,
        mindmapMeta,
        annotationsDoc,
        renderMermaidSvg: renderMermaidSvgForExport,
        renderMindmapSvg: renderMindmapSvgForExport,
      });
      if (typeof window.showSaveFilePicker === 'function') {
        await saveStandalonePrdExportToDirectory(exported);
        emitPrdToast(`导出成功：${exported.fileName}`, {
          id: 'prd-export',
          tone: 'success',
          duration: 2400,
        });
      } else {
        downloadStandalonePrdExport(exported);
        emitPrdToast('当前浏览器不支持保存对话框，已改为直接下载 ZIP 包', {
          id: 'prd-export',
          tone: 'warning',
          duration: 3200,
        });
      }
    } catch (error) {
      if (error?.name === 'AbortError') {
        emitPrdToast('已取消导出', {
          id: 'prd-export',
          tone: 'warning',
          duration: 1800,
        });
      } else {
        emitPrdToast(`导出失败：${error?.message || error}`, {
          id: 'prd-export',
          tone: 'error',
          duration: 3600,
        });
      }
    } finally {
      setIsExporting(false);
    }
  }, [annotationsDoc, blocks, imageMeta, isExporting, mermaidMeta, mindmapMeta]);

  const blockUiState = useMemo(() => ({
    activeActionBlockId,
    activeInsertMenuOwnerId,
    focusBlockId,
    requestActionbarOpen,
    requestActionbarClose,
    keepActionbarOpen,
    clearActionbarState,
    openInsertMenu,
    closeInsertMenu,
    setFocusBlockId,
    registerBlockRef,
    clearFocusBlockId,
    onEditingFinishedBlock: clearAutoCreatedOrderedSeed,
  }), [
    activeActionBlockId,
    activeInsertMenuOwnerId,
    focusBlockId,
    requestActionbarOpen,
    requestActionbarClose,
    keepActionbarOpen,
    clearActionbarState,
    openInsertMenu,
    closeInsertMenu,
    registerBlockRef,
    clearFocusBlockId,
    clearAutoCreatedOrderedSeed,
  ]);

  const selectionState = useMemo(() => ({
    globalSelection,
    setGlobalSelection,
  }), [globalSelection]);

  const sidecarState = useMemo(() => ({
    imageMeta,
    onImageWidthChange: handleImageWidthChange,
    mermaidMeta,
    onMermaidMetaChange: handleMermaidMetaChange,
    mindmapMeta,
    onMindmapMetaChange: handleMindmapMetaChange,
  }), [
    imageMeta,
    handleImageWidthChange,
    mermaidMeta,
    handleMermaidMetaChange,
    mindmapMeta,
    handleMindmapMetaChange,
  ]);

  const annotationState = useMemo(() => ({
    annotationsDoc,
    onAnnotateUsage: handleOpenAnnotationModal,
    onSetCellChangeIntent: handleSetCellChangeIntent,
    onSetCellPendingConfirm: handleSetCellPendingConfirm,
    onSetCellPendingConfirmNote: handleSetCellPendingConfirmNote,
    onCellEdited: handleMarkCellManual,
    onResetOrderedStartBlock: handleResetOrderedStart,
  }), [
    annotationsDoc,
    handleOpenAnnotationModal,
    handleSetCellChangeIntent,
    handleSetCellPendingConfirm,
    handleSetCellPendingConfirmNote,
    handleMarkCellManual,
    handleResetOrderedStart,
  ]);

  const blockCanvasCallbacks = useMemo(() => ({
    onUpdate: handleUpdate,
    onDelete: handleDeleteRequest,
    onDuplicate: handleDuplicateBlock,
    onInsertBefore: handleInsertBefore,
    onInsertAfter: handleInsertAfter,
    onMoveUp: handleMoveUp,
    onMoveDown: handleMoveDown,
    onEnterBlock: handleEnterBlock,
    onBackspaceEmptyBlock: handleBackspaceEmpty,
    onPasteImageAsBlockBlock: handlePasteImageAsBlock,
    onAddAtEnd: handleAddAtEnd,
  }), [
    handleUpdate,
    handleDeleteRequest,
    handleDuplicateBlock,
    handleInsertBefore,
    handleInsertAfter,
    handleMoveUp,
    handleMoveDown,
    handleEnterBlock,
    handleBackspaceEmpty,
    handlePasteImageAsBlock,
    handleAddAtEnd,
  ]);

  // ── 渲染 ────────────────────────────────────────────────────────────────────

  if (loadErr) {
    return (
      <div className="prd-page">
        <ToastViewport toasts={toasts} />
        <div className="prd-page__layout">
          <div className="prd-page__content-pane">
            <PrdToolbar
              activeSlug={activeSlug}
              blocks={null}
              exporting={false}
              onExport={() => {}}
              onSwitch={(slug) => {
                activeSlugRef.current = slug;
                setActiveSlug(slug);
                setBlocks(null);
                setLoadErr('');
                lastSavedMdRef.current = '';
                hasPendingLocalChangesRef.current = false;
                hasExternalMdConflictRef.current = false;
                fetchActiveDoc().then(({ mdPath }) => {
                  activeMdPathRef.current = mdPath;
                  fetchPrdMd(mdPath)
                    .then((md) => applyLoadedPrdMd(md, { restoreSnapshot: readPersistedViewportSnapshot(slug) }))
                    .catch((e) => setLoadErr(e.message));
                });
              }}
            />
            <div className="prd-page__error">
              暂无文档，请在左上角文档选择器中点击「新建文档」创建你的第一个 PRD。
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (!blocks) {
    return (
      <div className="prd-page">
        <div className="prd-page__loading">加载中…</div>
      </div>
    );
  }

  const deleteBlock = blocks.find((b) => b.id === deleteTarget);

  return (
    <div className="prd-page">
        <ToastViewport toasts={toasts} />

        {/* 刪除確認彈窗 */}
        {deleteTarget && deleteBlock && (
          <DeleteConfirmModal
            block={deleteBlock}
            onConfirm={handleDeleteConfirm}
            onCancel={() => setDeleteTarget(null)}
          />
        )}

        <div className="prd-page__layout">
          <OutlineSidebar
            open={isTocOpen}
            items={tocItems}
            activeId={activeTocId}
            onInteract={clearUiSelection}
            onToggle={toggleToc}
            onItemClick={handleTocItemClick}
          />
          <div className="prd-page__content-pane">
            <PrdToolbar
              activeSlug={activeSlug}
              blocks={blocks}
              exporting={isExporting}
              onExport={handleExportStandalone}
              onSwitch={(slug) => {
                activeSlugRef.current = slug;
                setActiveSlug(slug);
                setBlocks(null);
                setLoadErr('');
                lastSavedMdRef.current = '';
                hasPendingLocalChangesRef.current = false;
                hasExternalMdConflictRef.current = false;
                fetchActiveDoc().then(({ mdPath }) => {
                  activeMdPathRef.current = mdPath;
                  fetchPrdMd(mdPath)
                    .then((md) => applyLoadedPrdMd(md, { restoreSnapshot: readPersistedViewportSnapshot(slug) }))
                    .catch((e) => setLoadErr(e.message));
                });
                fetchPrdMeta(slug).then((meta) => {
                  imageMetaRef.current = meta;
                  setImageMeta(meta);
                  const mm = { mermaidViewModes: meta.mermaidViewModes || {}, mermaidWidths: meta.mermaidWidths || {} };
                  mermaidMetaRef.current = mm;
                  setMermaidMeta(mm);
                  const mindmapM = { mindmapViewModes: meta.mindmapViewModes || {}, mindmapWidths: meta.mindmapWidths || {} };
                  mindmapMetaRef.current = mindmapM;
                  setMindmapMeta(mindmapM);
                });
                fetchPrdAnnotations(slug).then((doc) => {
                  const normalized = normalizeAnnotationsDoc(doc);
                  annotationsRef.current = normalized;
                  annotationsReadyRef.current = true;
                  setAnnotationsDoc(normalized);
                });
              }}
            />
            <div
              ref={contentScrollRef}
              className="prd-page__content-scroll"
              onMouseDown={(e) => {
                // 點擊 block 內容區域（有 data-prd-no-block-select）不清除
                if (e.defaultPrevented || e.target.closest('[data-prd-no-block-select]')) return;
                clearUiSelection();
              }}
            >
              <BlockCanvas
                blocks={blocks}
                blockUiState={blockUiState}
                selectionState={selectionState}
                sidecarState={sidecarState}
                annotationState={annotationState}
                rowBindingsByBlock={rowBindingsByBlock}
                blockPerfKeysById={blockPerfKeysById}
                callbacks={blockCanvasCallbacks}
              />
            </div>
          </div>
        </div>
        {annotationModalState?.usage && (
          <Suspense fallback={null}>
            <PrdAnnotationModalLazy
              open
              usage={annotationModalState.usage}
              imageSrc={annotationModalState.usage.sourceImageSrc || ''}
              regions={getUsageRegions(annotationsDoc, annotationModalState.usage.usageId)}
              settings={mergeAnnotationSettingsWithLocalStorage(annotationsDoc.settings)}
              onClose={() => setAnnotationModalState(null)}
              onSave={(regions, imageInfo, usagePatch) => handleSaveUsageAnnotations(
                annotationModalState.usage,
                regions,
                imageInfo,
                usagePatch,
              )}
            />
          </Suspense>
        )}
      </div>
  );
}
