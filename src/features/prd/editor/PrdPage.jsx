import {
  Suspense, forwardRef, lazy, memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
} from 'react';
import { createPortal } from 'react-dom';
import {
  FiAlertCircle,
  FiAlertTriangle,
  FiCheckCircle,
  FiChevronsLeft,
  FiMenu,
  FiCode,
  FiBarChart2,
  FiDownload,
  FiLayers,
  FiPlus,
  FiCheck,
  FiX,
  FiEdit2,
  FiChevronDown,
} from 'react-icons/fi';
import { BsArrowDownShort, BsArrowUpShort } from 'react-icons/bs';
import '../../../shared/styles/prd-table.css';
import '../../../shared/styles/prd-section.css';
import './styles/prd.css';
import './styles/prd-annotations.css';
import './styles/prd-overview.css';
import './styles/prd-page-edit.css';
import { parsePrd } from './prd-parser';
import { serializePrd } from './prd-writer';
import { useViewportFit } from './useViewportFit.js';
import { emitPrdToast, PRD_TOAST_EVENT } from './prd-toast.js';
import { FeishuSyncEntry } from '../../feishu-sync/index.jsx';
import {
  buildStandalonePrdExport,
  downloadStandalonePrdExport,
  saveStandalonePrdExportToDirectory,
} from './prd-export.js';
import {
  adjustOrderedMarkerAfterIndent,
  createTypedMarkdownListOptions,
  dedentMarkdown,
  hasIndent,
  hasListPrefix,
  indentMarkdown,
  inferListPrefix,
  isBareListPrefixMd,
  isEmptyOrderedListMd,
  parseListPrefix,
  renumberOrderedGroupAt,
  renumberOrderedItemsFrom,
  replaceListPrefixMd,
} from './prd-list-utils.js';
import { TiptapMarkdownEditor } from './TiptapMarkdownEditor.jsx';
import { buildCropBase64, buildFocusBase64, loadImageElement } from './prd-annotation-images.js';
import { measurePrdTask, recordPrdInteraction } from './prd-performance.js';
import {
  buildDerivedAssetNames,
  buildTableBindings,
  createEmptyAnnotationsDoc,
  getCellColumnKey,
  getCellState,
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

// ─── 常量 ────────────────────────────────────────────────────────────────────

const SAVE_API = '/__prd__/save-md';
const DELETE_IMAGE_API = '/__prd__/delete-image';
const META_API = '/__prd__/meta';
const SAVE_META_API = '/__prd__/save-meta';
const ANNOTATIONS_API = '/__prd__/annotations';
const SAVE_ANNOTATIONS_API = '/__prd__/save-annotations';
const SAVE_ANNOTATION_ASSET_API = '/__prd__/save-annotation-asset';
const DELETE_ANNOTATION_ASSET_API = '/__prd__/delete-annotation-asset';
const PRD_EVENTS_API = '/__prd__/events';
const ACTIVE_DOC_API = '/__prd__/active-doc';
const LIST_DOCS_API = '/__prd__/list-docs';
const CREATE_DOC_API = '/__prd__/create-doc';
const SWITCH_DOC_API = '/__prd__/switch-doc';
const TOC_OPEN_STORAGE_KEY = 'prd-editor:toc-open';

/** 由 active-doc API 决定，初始占位 */
const DEFAULT_PRD_SLUG = 'doc-001';
const EMPTY_ANNOTATIONS_DOC = createEmptyAnnotationsDoc();
const EMPTY_MERMAID_META = { mermaidViewModes: {}, mermaidWidths: {} };
const EMPTY_MINDMAP_META = { mindmapViewModes: {}, mindmapWidths: {} };
const EMPTY_BLOCK_PERF_KEYS = {
  selectionKey: 'none',
  rowBindingsKey: '',
  imageMetaKey: '',
  annotationsKey: '',
  mermaidMetaKey: '',
  mindmapMetaKey: '',
};

const PrdAnnotationModalLazy = lazy(() => import('./PrdAnnotationModal.jsx').then((mod) => ({
  default: mod.PrdAnnotationModal,
})));

function slugToMdPath(slug) {
  return `/pages/${slug}/prd.md`;
}

function slugToApiSuffix(slug) {
  return `?slug=${encodeURIComponent(slug)}`;
}
const EMPTY_ROW_BINDINGS = [];

const PRD_FILE_NAME_RULE_HINT = '仅支持小写英文、数字、.、_、-；空格和其它字符会自动转为 -';

function normalizeProjectLikeName(name) {
  return String(name || '')
    .trim()
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/\s+/g, '-')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/[-._]{2,}/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/^[._]+|[._]+$/g, '')
    .toLowerCase()
    .slice(0, 80);
}

function mapPrdFileNameError(error) {
  if (error === 'name must contain english letters, numbers, dots, underscores or hyphens') return '请输入合法文件名';
  if (error === 'newName must contain english letters, numbers, dots, underscores or hyphens') return '请输入合法文件名';
  return error || '';
}

/** 防抖写入磁盘，减少连续编辑时的序列化与网络压力 */
const PERSIST_DEBOUNCE_MS = 480;
const TOAST_EXIT_MS = 220;
const ACTIONBAR_OPEN_DELAY_MS = 56;
const ACTIONBAR_SWITCH_DELAY_MS = 120;
const ACTIONBAR_CLOSE_DELAY_MS = 140;
const TABLE_HOVER_CLOSE_DELAY_MS = 140;
const HEADING_BLOCK_TYPES = Array.from({ length: 7 }, (_, index) => `h${index + 1}`);
const BLOCK_LEVEL_TYPES = ['paragraph', ...HEADING_BLOCK_TYPES];
const HEADING_BLOCK_TYPE_SET = new Set(HEADING_BLOCK_TYPES);
const BLOCK_LEVEL_OPTIONS = BLOCK_LEVEL_TYPES.map((type) => ({
  value: type,
  label: type === 'paragraph' ? '正文' : type.toUpperCase(),
}));

function getHeadingFontSize(tag) {
  switch (tag) {
    case 'h1': return '24px';
    case 'h2': return '18px';
    case 'h3': return '15px';
    case 'h4': return '13px';
    case 'h5': return '12px';
    case 'h6': return '11px';
    case 'h7': return '10px';
    default: return '15px';
  }
}

function viewportSnapshotKey(slug) {
  return `prd-editor:viewport:${slugToMdPath(slug || DEFAULT_PRD_SLUG)}`;
}

function readPersistedViewportSnapshot(slug) {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(viewportSnapshotKey(slug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      scrollTop: Number(parsed.scrollTop) || 0,
      anchorIndex: Number.isInteger(parsed.anchorIndex) ? parsed.anchorIndex : null,
      anchorSignature: typeof parsed.anchorSignature === 'string' ? parsed.anchorSignature : '',
      anchorOffsetTop: Number(parsed.anchorOffsetTop) || 0,
    };
  } catch {
    return null;
  }
}

function persistViewportSnapshot(snapshot, slug) {
  if (typeof window === 'undefined' || !snapshot) return;
  try {
    window.localStorage.setItem(
      viewportSnapshotKey(slug),
      JSON.stringify({
        scrollTop: snapshot.scrollTop ?? 0,
        anchorIndex: snapshot.anchorIndex ?? null,
        anchorSignature: snapshot.anchorSignature ?? '',
        anchorOffsetTop: snapshot.anchorOffsetTop ?? 0,
      }),
    );
  } catch {
    // 忽略 localStorage 不可用 / 超额等异常，避免影响编辑体验。
  }
}

let _toastSeq = 0;

/** 从任意 Markdown 正文中收集 /prd/ 下的图片路径 */
function extractPrdImagePaths(text) {
  const set = new Set();
  if (!text || typeof text !== 'string') return set;
  const re = /\/prd\/[a-zA-Z0-9_.-]+\.(?:png|jpe?g|gif|webp)/gi;
  let m;
  while ((m = re.exec(text)) !== null) set.add(m[0]);
  return set;
}

function diffRemovedPrdPaths(oldMd, newMd) {
  const oldSet = extractPrdImagePaths(oldMd);
  const newSet = extractPrdImagePaths(newMd);
  return [...oldSet].filter((p) => !newSet.has(p));
}

async function uploadPastedImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async (e) => {
      const dataUrl = e.target.result;
      const base64 = dataUrl.split(',')[1];
      const ext = file.type === 'image/png' ? 'png'
        : file.type === 'image/gif' ? 'gif'
          : file.type === 'image/webp' ? 'webp'
            : 'jpg';
      const fileName = `paste-${Date.now()}.${ext}`;
      try {
        const res = await fetch('/__prd__/save-image', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileName, base64 }),
        });
        const data = await res.json();
        if (data.ok) {
          emitPrdToast('图片粘贴成功');
          resolve(data.path);
        }
        else reject(new Error(data.error));
      } catch (err) { reject(err); }
    };
    reader.readAsDataURL(file);
  });
}

async function copyImageToClipboard(src, { emitSuccessToast = true } = {}) {
  if (!src) return false;
  try {
    const res = await fetch(src, { cache: 'no-store' });
    if (!res.ok) throw new Error(`copy image failed: ${res.status}`);
    const blob = await res.blob();
    if (navigator.clipboard?.write && window.ClipboardItem) {
      await navigator.clipboard.write([
        new window.ClipboardItem({
          [blob.type || 'image/png']: blob,
        }),
      ]);
      if (emitSuccessToast) emitPrdToast('图片复制成功');
      return true;
    }
  } catch (err) {
    console.error('复制图片到剪贴板失败', err);
  }
  try {
    await navigator.clipboard?.writeText(src);
    if (emitSuccessToast) emitPrdToast('图片复制成功');
    return true;
  } catch (err) {
    console.error('复制图片地址失败', err);
    return false;
  }
}

async function cutImageToClipboard(src, onDelete) {
  const copied = await copyImageToClipboard(src, { emitSuccessToast: false });
  if (!copied) return false;
  onDelete?.();
  emitPrdToast('图片剪切成功');
  return true;
}

function getImageFromPaste(e) {
  const items = Array.from(e.clipboardData?.items || []);
  const imgItem = items.find((it) => it.kind === 'file' && it.type.startsWith('image/'));
  return imgItem ? imgItem.getAsFile() : null;
}

async function fetchPrdMeta(slug) {
  try {
    const res = await fetch(`${META_API}${slugToApiSuffix(slug || DEFAULT_PRD_SLUG)}`, { cache: 'no-store' });
    if (!res.ok) return {};
    return await res.json();
  } catch { return {}; }
}

async function savePrdMeta(meta, slug) {
  try {
    await fetch(`${SAVE_META_API}${slugToApiSuffix(slug || DEFAULT_PRD_SLUG)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(meta),
    });
  } catch (e) {
    console.error('meta save failed', e);
  }
}

async function fetchPrdAnnotations(slug) {
  try {
    const res = await fetch(`${ANNOTATIONS_API}${slugToApiSuffix(slug || DEFAULT_PRD_SLUG)}`, { cache: 'no-store' });
    if (!res.ok) return createEmptyAnnotationsDoc();
    return normalizeAnnotationsDoc(await res.json());
  } catch {
    return createEmptyAnnotationsDoc();
  }
}

async function savePrdAnnotations(doc, slug) {
  try {
    await fetch(`${SAVE_ANNOTATIONS_API}${slugToApiSuffix(slug || DEFAULT_PRD_SLUG)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(doc),
    });
  } catch (e) {
    console.error('annotations save failed', e);
  }
}

async function saveAnnotationAsset(fileName, base64) {
  const res = await fetch(SAVE_ANNOTATION_ASSET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fileName, base64 }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'save annotation asset failed');
  return data.path || data.url;
}

async function deleteAnnotationAsset(urlPath) {
  const res = await fetch(DELETE_ANNOTATION_ASSET_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: urlPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'delete annotation asset failed');
}

async function deletePrdImage(urlPath) {
  const res = await fetch(DELETE_IMAGE_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: urlPath }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'delete image failed');
}

let _idSeq = 0;
function genId() {
  return `blk-${Date.now()}-${++_idSeq}`;
}

const BLOCK_TYPE_LABELS = {
  h1: 'H1 标题',
  h2: 'H2 标题',
  h3: 'H3 标题',
  h4: 'H4 标题',
  h5: 'H5 标题',
  h6: 'H6 标题',
  h7: 'H7 标题',
  paragraph: '段落文字',
  table: '表格',
  mermaid: 'Mermaid 图表',
  mindmap: '思维导图',
  'prd-section-template': 'PRD 章节（标题+表格模板）',
  divider: '分隔线',
};

const ELEMENT_TYPE_LABELS = {
  text: '文本',
  image: '图片',
  mermaid: 'Mermaid 图表',
  mindmap: '思维导图',
};

/** 全局唯一 UI 选中（与 Block hover 操作条分离）；仅点 main 空白或其它选中目标时变更 */
function isTableKindSelection(sel) {
  return sel && (sel.type === 'table-col' || sel.type === 'table-row');
}


const ActionPanel = forwardRef(function ActionPanel({
  visible = true, className = '', onMouseEnter, onMouseLeave, children,
}, ref) {
  return (
    <div
      ref={ref}
      data-prd-no-block-select
      className={[
        'prd-action-panel',
        visible ? 'prd-action-panel--visible' : '',
        className,
      ].filter(Boolean).join(' ')}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {children}
    </div>
  );
});

const BUBBLE_GAP = 6;
const BUBBLE_MARGIN = 8;
const TABLE_EDGE_HOTZONE_PX = 24;

function isNodeHovered(node) {
  return !!node && typeof node.matches === 'function' && node.matches(':hover');
}

function nodeContainsTarget(node, target) {
  return !!node && typeof Node !== 'undefined' && target instanceof Node && node.contains(target);
}

function resolveBoundaryHoverIndex(offset, size, index, canUseBefore, hotzone = TABLE_EDGE_HOTZONE_PX) {
  const distBefore = canUseBefore ? offset : Number.POSITIVE_INFINITY;
  const distAfter = size - offset;
  if (distBefore > hotzone && distAfter > hotzone) return null;
  return distBefore <= distAfter ? index - 1 : index;
}

/**
 * 選取格式浮窗 / 鏈接氣泡共用。
 * 使用 Portal + position:fixed，完全不受父層 overflow / offsetParent 影響。
 * anchorRef：指向「錨點 DOM」（輸入框 / 標籤），浮窗依其 getBoundingClientRect 定位。
 * 若未傳 anchorRef，退回原本 absolute 定位（鏈接氣泡場景）。
 */
function FloatingActionBubble({
  visible,
  preferredVertical = 'below',
  preferredHorizontal = 'left',
  /** 錨點 ref（input / textarea / span），用於 fixed 定位計算 */
  anchorRef,
  onMouseEnter,
  onMouseLeave,
  /** 內層攔截 mousedown：鏈接氣泡傳 stopPropagation；選取工具列預設 preventDefault */
  innerMouseDown,
  /** 可選：供外部 contains 判斷（如鏈接氣泡關閉） */
  panelRef,
  className = '',
  children,
}) {
  const selfRef = useRef(null);
  const [style, setStyle] = useState(null);

  const reposition = useCallback(() => {
    const anchor = anchorRef?.current;
    const self = selfRef.current;
    if (!anchor || !self) return;

    const ar = anchor.getBoundingClientRect();
    const sw = self.offsetWidth || 0;
    const sh = self.offsetHeight || 0;
    const vw = window.innerWidth;
    const vh = window.innerHeight;

    // 垂直方向：優先 preferredVertical，空間不足時翻轉
    const spaceAbove = ar.top - BUBBLE_MARGIN;
    const spaceBelow = vh - ar.bottom - BUBBLE_MARGIN;
    let top;
    if (preferredVertical === 'above') {
      if (spaceAbove >= sh + BUBBLE_GAP || spaceAbove >= spaceBelow) {
        top = ar.top - BUBBLE_GAP - sh;
      } else {
        top = ar.bottom + BUBBLE_GAP;
      }
    } else {
      if (spaceBelow >= sh + BUBBLE_GAP || spaceBelow >= spaceAbove) {
        top = ar.bottom + BUBBLE_GAP;
      } else {
        top = ar.top - BUBBLE_GAP - sh;
      }
    }
    // 確保不超出視窗頂底
    top = Math.max(BUBBLE_MARGIN, Math.min(top, vh - sh - BUBBLE_MARGIN));

    // 水平方向
    let left;
    if (preferredHorizontal === 'right') {
      left = ar.right - sw;
    } else {
      left = ar.left;
    }
    left = Math.max(BUBBLE_MARGIN, Math.min(left, vw - sw - BUBBLE_MARGIN));

    setStyle({ position: 'fixed', top: Math.round(top), left: Math.round(left), zIndex: 9999 });
  }, [anchorRef, preferredVertical, preferredHorizontal]);

  useLayoutEffect(() => {
    if (!visible || !anchorRef) return;
    reposition();
    const raf = requestAnimationFrame(reposition);
    window.addEventListener('resize', reposition);
    window.addEventListener('scroll', reposition, true);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', reposition);
      window.removeEventListener('scroll', reposition, true);
    };
  }, [visible, anchorRef, reposition]);

  const setRef = useCallback((node) => {
    selfRef.current = node;
    if (panelRef) panelRef.current = node;
    if (node && anchorRef) reposition();
  }, [panelRef, anchorRef, reposition]);

  if (!visible) return null;

  const inner = (
    <div
      ref={anchorRef ? setRef : (node) => { selfRef.current = node; if (panelRef) panelRef.current = node; }}
      data-prd-no-block-select
      className={[
        'prd-action-panel prd-action-panel--visible',
        'prd-floating-action-bubble',
        className,
      ].filter(Boolean).join(' ')}
      style={anchorRef ? (style ?? { visibility: 'hidden', position: 'fixed' }) : undefined}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <span
        className="prd-floating-action-bubble__inner"
        onMouseDown={innerMouseDown ?? ((e) => {
          e.preventDefault();
          e.stopPropagation();
        })}
      >
        {children}
      </span>
    </div>
  );

  // Portal 模式（anchorRef 存在）：渲染到 body，完全脫離父層裁切
  if (anchorRef) {
    return createPortal(inner, document.body);
  }
  // 退回原本 absolute 定位（鏈接 tag 氣泡）
  return inner;
}

// ─── API ─────────────────────────────────────────────────────────────────────

async function fetchPrdMd(mdPath) {
  const res = await fetch(`${mdPath}?t=${Date.now()}`);
  if (!res.ok) throw new Error(`fetch md failed: ${res.status}`);
  return res.text();
}

async function savePrdMd(mdText, slug) {
  const res = await fetch(`${SAVE_API}${slugToApiSuffix(slug || DEFAULT_PRD_SLUG)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: mdText }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) throw new Error(data.error || 'save failed');
}

async function fetchActiveDoc() {
  const res = await fetch(`${ACTIVE_DOC_API}?t=${Date.now()}`);
  if (!res.ok) return { slug: DEFAULT_PRD_SLUG, mdPath: slugToMdPath(DEFAULT_PRD_SLUG) };
  return res.json().then(d => ({
    slug: d.slug || DEFAULT_PRD_SLUG,
    mdPath: d.mdPath || slugToMdPath(d.slug || DEFAULT_PRD_SLUG),
  }));
}

async function fetchDocList() {
  const res = await fetch(`${LIST_DOCS_API}?t=${Date.now()}`);
  if (!res.ok) return [];
  const data = await res.json();
  return data.docs || [];
}

async function createDoc(name) {
  const res = await fetch(CREATE_DOC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  return res.json();
}

async function switchDoc(slug) {
  const res = await fetch(SWITCH_DOC_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug }),
  });
  return res.json();
}

async function renameDoc(slug, newName) {
  const res = await fetch('/__prd__/rename-doc', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, newName }),
  });
  return res.json();
}

// ─── 輔助工具 ────────────────────────────────────────────────────────────────

/** 在純文字區間 [start,end) 外包裹 Markdown 粗體 ** */
function wrapSelectionWithBold(text, start, end) {
  if (text == null || start == null || end == null || start >= end) return null;
  const s = Math.max(0, Math.min(start, text.length));
  const e = Math.max(s, Math.min(end, text.length));
  const before = text.slice(0, s);
  const mid = text.slice(s, e);
  const after = text.slice(e);
  const next = `${before}**${mid}**${after}`;
  return { next, selStart: s + 2, selEnd: s + 2 + mid.length };
}

function getTextOffsetFromPoint(container, clientX, clientY) {
  if (!container || typeof document === 'undefined') return null;
  const totalLength = container.textContent?.length ?? 0;
  let range = null;
  if (document.caretPositionFromPoint) {
    const pos = document.caretPositionFromPoint(clientX, clientY);
    if (pos) {
      range = document.createRange();
      range.setStart(pos.offsetNode, pos.offset);
      range.collapse(true);
    }
  } else if (document.caretRangeFromPoint) {
    range = document.caretRangeFromPoint(clientX, clientY);
  }
  if (range && container.contains(range.startContainer)) {
    const prefixRange = document.createRange();
    prefixRange.selectNodeContents(container);
    prefixRange.setEnd(range.startContainer, range.startOffset);
    return Math.max(0, Math.min(prefixRange.toString().length, totalLength));
  }
  const rect = container.getBoundingClientRect();
  if (clientX <= rect.left) return 0;
  if (clientX >= rect.right) return totalLength;
  return totalLength;
}

function cloneSerializable(value) {
  if (typeof structuredClone === 'function') return structuredClone(value);
  return JSON.parse(JSON.stringify(value));
}


function getShortcutBlockLevel(e) {
  if (!(e.altKey && (e.metaKey || e.ctrlKey))) return null;
  if (e.key === '0') return 'paragraph';
  if (/^[1-7]$/.test(e.key)) return `h${e.key}`;
  return null;
}

// ─── 可編輯純文字欄位（單行）────────────────────────────────────────────────

function EditableField({
  value,
  onSave,
  placeholder = '点击编辑…',
  className = '',
  blockId,
  selectionRole,
  globalSelection,
  setGlobalSelection,
  onEnter,
  onBackspaceEmpty,
  onEditingFinished,
  /** 當前 block 層級（h1–h7/paragraph），用於標題浮窗；未傳則不顯示層級按鈕 */
  blockLevel,
  onBlockLevelChange,
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const ref = useRef(null);
  const previewRef = useRef(null);
  const pendingCaretOffsetRef = useRef(null);
  /** 有選取時顯示浮窗（避免 blur 丟失選區用 ref 記錄） */
  const selRef = useRef({ start: 0, end: 0 });
  const [showSelToolbar, setShowSelToolbar] = useState(false);

  useEffect(() => { setDraft(value); }, [value]);
  useEffect(() => {
    if (!editing || !ref.current) return;
    ref.current.focus();
    const caret = pendingCaretOffsetRef.current;
    if (typeof caret === 'number') {
      const safeCaret = Math.max(0, Math.min(caret, ref.current.value.length));
      ref.current.setSelectionRange(safeCaret, safeCaret);
      selRef.current = { start: safeCaret, end: safeCaret };
      pendingCaretOffsetRef.current = null;
    }
  }, [editing]);

  const syncSelection = useCallback(() => {
    const el = ref.current;
    if (!el || typeof el.selectionStart !== 'number') return;
    const a = el.selectionStart;
    const b = el.selectionEnd;
    selRef.current = { start: a, end: b };
    setShowSelToolbar(a !== b);
  }, []);

  const commit = useCallback(() => {
    setEditing(false);
    setShowSelToolbar(false);
    if (draft !== value) onSave(draft);
    onEditingFinished?.();
  }, [draft, value, onSave, onEditingFinished]);

  const applyBold = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { start, end } = selRef.current;
    const r = wrapSelectionWithBold(draft, start, end);
    if (!r) return;
    setDraft(r.next);
    requestAnimationFrame(() => {
      if (ref.current) {
        ref.current.setSelectionRange(r.selStart, r.selEnd);
        selRef.current = { start: r.selStart, end: r.selEnd };
        ref.current.focus();
      }
    });
  }, [draft]);

  const applyBlockLevel = useCallback((nextType) => {
    if (!onBlockLevelChange || nextType === blockLevel) return;
    onBlockLevelChange(nextType, draft);
  }, [onBlockLevelChange, blockLevel, draft]);

  const updateDraftAndKeepFocus = useCallback((nextDraft) => {
    setDraft(nextDraft);
    setShowSelToolbar(false);
    onSave(nextDraft);
    requestAnimationFrame(() => {
      if (!ref.current) return;
      const pos = nextDraft.length;
      ref.current.focus();
      ref.current.setSelectionRange(pos, pos);
      selRef.current = { start: pos, end: pos };
    });
  }, [onSave]);

  const onKeyDown = useCallback((e) => {
    const isMeta = e.metaKey || e.ctrlKey;
    const parsed = parseListPrefix(draft);
    const shortcutLevel = getShortcutBlockLevel(e);

    // 空格：检测行首 `数字.` / `字母.` / `- ` 触发列表前缀
    if (e.key === ' ' && !parsed && ref.current) {
      const cursorPos = ref.current.selectionStart;
      const candidate = draft.slice(0, cursorPos);
      const listTrigger = candidate.match(/^(\d+\.|[a-z]+\.|[-*+])$/);
      if (listTrigger) {
        e.preventDefault();
        const newPrefix = listTrigger[0] + ' ';
        const rest = draft.slice(cursorPos);
        updateDraftAndKeepFocus(newPrefix + rest);
        return;
      }
    }

    if (shortcutLevel && onBlockLevelChange) {
      e.preventDefault();
      applyBlockLevel(shortcutLevel);
      return;
    }

    if (isMeta && e.shiftKey && e.key === '8') {
      e.preventDefault();
      updateDraftAndKeepFocus(
        parsed && /^[-*+]$/.test(parsed.marker)
          ? (parsed.body ?? '')
          : replaceListPrefixMd(draft, '- '),
      );
      return;
    }

    if (isMeta && e.shiftKey && e.key === '7') {
      e.preventDefault();
      updateDraftAndKeepFocus(
        parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker)
          ? (parsed.body ?? '')
          : replaceListPrefixMd(draft, '1. '),
      );
      return;
    }

    if (e.key === 'Tab') {
      e.preventDefault();
      if (!hasListPrefix(draft)) return;
      if (e.shiftKey) {
        if (!hasIndent(draft)) return;
        updateDraftAndKeepFocus(adjustOrderedMarkerAfterIndent(dedentMarkdown(draft)));
      } else {
        updateDraftAndKeepFocus(adjustOrderedMarkerAfterIndent(indentMarkdown(draft)));
      }
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      commit();
      onEnter?.(draft);
      return;
    }
    if (e.key === 'Backspace' && onBackspaceEmpty && draft === '') {
      e.preventDefault();
      onBackspaceEmpty();
      return;
    }
    if (e.key === 'Backspace' && isBareListPrefixMd(draft)) {
      const input = ref.current;
      const cursorAtEnd = input
        && input.selectionStart === input.selectionEnd
        && input.selectionEnd === draft.length;
      if (cursorAtEnd) {
        e.preventDefault();
        updateDraftAndKeepFocus('');
        return;
      }
    }
    if (e.key === 'Escape') {
      setDraft(value);
      setEditing(false);
      setShowSelToolbar(false);
      onEditingFinished?.();
    }
  }, [
    applyBlockLevel,
    blockLevel,
    onBlockLevelChange,
    commit,
    value,
    draft,
    onEnter,
    onBackspaceEmpty,
    onEditingFinished,
    updateDraftAndKeepFocus,
  ]);

  const textLineSelected =
    blockId && selectionRole && globalSelection?.type === 'text-block'
    && globalSelection.blockId === blockId && globalSelection.role === selectionRole;

  const onPasteImage = useCallback(async (e) => {
    const file = getImageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    try {
      const imagePath = await uploadPastedImage(file);
      const insert = `![粘贴图片](${imagePath})`;
      const el = ref.current;
      const start = typeof el?.selectionStart === 'number' ? el.selectionStart : draft.length;
      const end = typeof el?.selectionEnd === 'number' ? el.selectionEnd : draft.length;
      const next = draft.slice(0, start) + insert + draft.slice(end);
      setDraft(next);
      requestAnimationFrame(() => {
        if (ref.current) {
          const pos = start + insert.length;
          ref.current.setSelectionRange(pos, pos);
        }
      });
    } catch (err) {
      console.error('图片上传失败', err);
    }
  }, [draft]);

  const showBoldToolbar = blockLevel == null || !HEADING_BLOCK_TYPE_SET.has(blockLevel);
  const hasLevelSwitcher = blockLevel != null && onBlockLevelChange;
  const bubbleVisible = showSelToolbar || hasLevelSwitcher;

  if (editing) {
    return (
      <span className="prd-editable-field-edit-wrap">
        <FloatingActionBubble
          visible={bubbleVisible}
          preferredVertical="above"
          preferredHorizontal="left"
          anchorRef={ref}
        >
          {showSelToolbar && showBoldToolbar && (
            <button
              type="button"
              className="prd-action-btn prd-action-btn--bold"
              title="粗体（插入 **）"
              onMouseDown={(e) => e.preventDefault()}
              onClick={applyBold}
            >
              B
            </button>
          )}
          {hasLevelSwitcher && (
            <label className="prd-action-select-wrap" title="标题层级">
              <select
                className="prd-action-select"
                value={blockLevel}
                onMouseDown={(e) => e.stopPropagation()}
                onChange={(e) => applyBlockLevel(e.target.value)}
              >
                {BLOCK_LEVEL_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>
          )}
        </FloatingActionBubble>
        <input
          ref={ref}
          className={`prd-editable prd-editable--input ${className}`}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={onKeyDown}
          onPaste={onPasteImage}
          onMouseUp={syncSelection}
          onKeyUp={syncSelection}
          onSelect={syncSelection}
        />
      </span>
    );
  }
  return (
    <span
      className={[
        'prd-editable prd-editable--view',
        textLineSelected ? 'prd-editable--text-selected' : '',
        className,
      ].filter(Boolean).join(' ')}
      data-prd-no-block-select
      ref={previewRef}
      onMouseDown={(e) => {
        if (!setGlobalSelection || !blockId || !selectionRole) return;
        setGlobalSelection({ type: 'text-block', blockId, role: selectionRole });
        pendingCaretOffsetRef.current = getTextOffsetFromPoint(previewRef.current, e.clientX, e.clientY);
        e.stopPropagation();
      }}
      onClick={() => setEditing(true)}
    >
      {value || <span className="prd-editable__placeholder">{placeholder}</span>}
    </span>
  );
}

// ─── MermaidRenderer ─────────────────────────────────────────────────────────

let _mermaidInitialized = false;
let _mermaidLibPromise = null;
async function getMermaidLib() {
  if (!_mermaidLibPromise) {
    _mermaidLibPromise = import('mermaid').then((mod) => mod.default || mod);
  }
  const mermaidLib = await _mermaidLibPromise;
  if (_mermaidInitialized) return mermaidLib;
  _mermaidInitialized = true;
  mermaidLib.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
  });
  return mermaidLib;
}

let _mermaidRenderSeq = 0;
let _markmapDepsPromise = null;
let _markmapTransformer = null;

async function getMarkmapDeps() {
  if (!_markmapDepsPromise) {
    _markmapDepsPromise = Promise.all([
      import('markmap-lib'),
      import('markmap-view'),
    ]).then(([libMod, viewMod]) => ({
      Transformer: libMod.Transformer,
      Markmap: viewMod.Markmap,
    }));
  }
  const deps = await _markmapDepsPromise;
  if (!_markmapTransformer) _markmapTransformer = new deps.Transformer();
  return {
    ...deps,
    transformer: _markmapTransformer,
  };
}

const LIGHTBOX_ZOOM_STEP = 0.05;
/**
 * 把 mermaid 代码映射到稳定的 meta key（djb2 hash）。
 * 刷新页面后只要代码不变，key 就不变。
 */
function mermaidCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return `mermaid_${h.toString(36)}`;
}

/** 顶层 mermaid block 的默认宽度（px），与当前主文档中实测的初始宽度一致 */
const MERMAID_BLOCK_DEFAULT_WIDTH = 628;

function mindmapCodeToMetaKey(code) {
  const s = (code || '').trim();
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0;
  }
  return `mindmap_${h.toString(36)}`;
}

const MINDMAP_BLOCK_DEFAULT_WIDTH = 628;

function sameNumberArray(a, b) {
  if (a === b) return true;
  if (!a || !b || a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

function sameTableGeom(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  return sameNumberArray(a.colLeft, b.colLeft)
    && sameNumberArray(a.colWidth, b.colWidth)
    && sameNumberArray(a.colRight, b.colRight)
    && sameNumberArray(a.rowTop, b.rowTop)
    && sameNumberArray(a.rowHeight, b.rowHeight)
    && sameNumberArray(a.rowBottom, b.rowBottom);
}

function getBlockTextContent(block) {
  if (!block || !block.content) return '';
  if (typeof block.content.markdown === 'string') return block.content.markdown;
  if (typeof block.content.text === 'string') return block.content.text;
  return '';
}

function getCellElements(cell) {
  if (cell && typeof cell === 'object' && Array.isArray(cell.elements)) return cell.elements;
  if (cell && typeof cell === 'object' && 'element' in cell) return [cell.element];
  if (typeof cell === 'string') return [];
  return [];
}

function getBlockSelectionPerfKey(block, selection) {
  if (!selection) return 'none';
  if (selection.blockId === block.id) {
    const cellPath = selection.cellPath
      ? `${selection.cellPath.ri ?? ''}.${selection.cellPath.ci ?? ''}.${selection.cellPath.idx ?? ''}`
      : '';
    return [
      'own',
      selection.type || '',
      selection.role || '',
      selection.ri ?? '',
      selection.ci ?? '',
      cellPath,
    ].join(':');
  }
  if (block.type === 'table' && isTableKindSelection(selection)) return 'foreign-table';
  return 'other-selection';
}

function getRowBindingsPerfKey(rowBindings) {
  if (!rowBindings?.length) return '';
  return rowBindings.map((binding) => [
    binding.rowKey,
    (binding.usages || []).map((usage) => usage.usageId).join(','),
  ].join(':')).join('|');
}

function getBlockImageMetaPerfKey(block, imageMeta) {
  if (block?.type !== 'paragraph') return '';
  const paths = [...extractPrdImagePaths(getBlockTextContent(block))].sort();
  if (!paths.length) return '';
  return paths.map((path) => `${path}:${imageMeta?.[path] ?? ''}`).join('|');
}

function getTableMetaPerfKeys(block) {
  const mermaidKeys = [];
  const mindmapKeys = [];
  if (block?.type !== 'table') return { mermaidKeys, mindmapKeys };
  for (const row of block.content?.rows || []) {
    for (const cell of row || []) {
      for (const element of getCellElements(cell)) {
        if (element?.type === 'mermaid') mermaidKeys.push(mermaidCodeToMetaKey(element.code || ''));
        if (element?.type === 'mindmap') mindmapKeys.push(mindmapCodeToMetaKey(element.code || ''));
      }
    }
  }
  return { mermaidKeys, mindmapKeys };
}

function getBlockMermaidMetaPerfKey(block, mermaidMeta) {
  if (block?.type === 'mermaid') {
    const key = mermaidCodeToMetaKey(block.content?.code || '');
    return `${key}:${mermaidMeta?.mermaidViewModes?.[key] || 'code'}:${mermaidMeta?.mermaidWidths?.[key] ?? MERMAID_BLOCK_DEFAULT_WIDTH}`;
  }
  if (block?.type !== 'table') return '';
  const { mermaidKeys } = getTableMetaPerfKeys(block);
  return mermaidKeys.map((key) => `${key}:${mermaidMeta?.mermaidViewModes?.[key] || 'code'}`).join('|');
}

function getBlockMindmapMetaPerfKey(block, mindmapMeta) {
  if (block?.type === 'mindmap') {
    const key = mindmapCodeToMetaKey(block.content?.code || '');
    return `${key}:${mindmapMeta?.mindmapViewModes?.[key] || 'code'}:${mindmapMeta?.mindmapWidths?.[key] ?? MINDMAP_BLOCK_DEFAULT_WIDTH}`;
  }
  if (block?.type !== 'table') return '';
  const { mindmapKeys } = getTableMetaPerfKeys(block);
  return mindmapKeys.map((key) => `${key}:${mindmapMeta?.mindmapViewModes?.[key] || 'code'}`).join('|');
}

function getTableAnnotationsPerfKey(rowBindings, annotationsDoc) {
  if (!rowBindings?.length) return '';
  const usageRegionCount = new Map(
    (annotationsDoc?.usages || []).map((usage) => [usage.usageId, getUsageRegions(annotationsDoc, usage.usageId).length]),
  );
  return rowBindings.map((binding) => {
    const state = annotationsDoc?.cellStates?.[binding.rowKey] || {};
    const stateKey = Object.entries(state)
      .map(([column, value]) => `${column}:${value?.changeIntent || ''}:${value?.pendingConfirm ? 1 : 0}:${value?.pendingConfirmNote || ''}`)
      .join(',');
    const usageKey = (binding.usages || [])
      .map((usage) => `${usage.usageId}:${usageRegionCount.get(usage.usageId) || 0}`)
      .join(',');
    return `${binding.rowKey}[${stateKey}](${usageKey})`;
  }).join('|');
}

const LIGHTBOX_ZOOM_MIN = 0.2;
const LIGHTBOX_ZOOM_MAX = 5;
const LIGHTBOX_ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 3];

/**
 * 通用 Lightbox：支持 imageSrc（图片）或 htmlContent（Mermaid SVG 等）。
 * 缩放 + 拖拽平移 + 键盘快捷键，图片和 Mermaid 复用同一套逻辑。
 */
function PrdLightbox({ imageSrc, htmlContent, onClose }) {
  const [scale, setScale] = useState(null);
  const [translate, setTranslate] = useState({ x: 0, y: 0 });
  const [dragging, setDragging] = useState(false);
  const dragStartRef = useRef(null);
  const contentRef = useRef(null);
  const fitScaleRef = useRef(1);

  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const raf = requestAnimationFrame(() => {
      const rect = el.getBoundingClientRect();
      const padX = 80;
      const padY = 120;
      const viewW = window.innerWidth - padX * 2;
      const viewH = window.innerHeight - padY * 2;
      const fit = Math.min(viewW / rect.width, viewH / rect.height, 1);
      const rounded = Math.round(fit * 100) / 100;
      fitScaleRef.current = rounded;
      setScale(rounded);
    });
    return () => cancelAnimationFrame(raf);
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setScale((prev) => {
      const delta = e.deltaY > 0 ? -LIGHTBOX_ZOOM_STEP : LIGHTBOX_ZOOM_STEP;
      return Math.min(LIGHTBOX_ZOOM_MAX, Math.max(LIGHTBOX_ZOOM_MIN, prev + delta));
    });
  }, []);

  useEffect(() => {
    const el = contentRef.current?.parentElement;
    if (!el) return;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handleBackdropMouseDown = useCallback((e) => {
    if (e.target === e.currentTarget) {
      onClose();
      return;
    }
    setDragging(true);
    dragStartRef.current = { x: e.clientX - translate.x, y: e.clientY - translate.y };
  }, [onClose, translate]);

  useEffect(() => {
    if (!dragging) return;
    const onMove = (e) => {
      if (!dragStartRef.current) return;
      setTranslate({
        x: e.clientX - dragStartRef.current.x,
        y: e.clientY - dragStartRef.current.y,
      });
    };
    const onUp = () => {
      setDragging(false);
      dragStartRef.current = null;
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [dragging]);

  const handleZoomIn = useCallback(() => {
    setScale((prev) => Math.min(LIGHTBOX_ZOOM_MAX, prev + LIGHTBOX_ZOOM_STEP));
  }, []);

  const handleZoomOut = useCallback(() => {
    setScale((prev) => Math.max(LIGHTBOX_ZOOM_MIN, prev - LIGHTBOX_ZOOM_STEP));
  }, []);

  const handleZoomReset = useCallback(() => {
    setScale(fitScaleRef.current);
    setTranslate({ x: 0, y: 0 });
  }, []);

  const handleZoomPreset = useCallback((preset) => {
    setScale(preset);
  }, []);

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') onClose();
      if (e.key === '+' || e.key === '=') handleZoomIn();
      if (e.key === '-') handleZoomOut();
      if (e.key === '0') handleZoomReset();
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, handleZoomIn, handleZoomOut, handleZoomReset]);

  const displayPercent = Math.round(scale * 100);
  const [inputValue, setInputValue] = useState(String(displayPercent));
  const inputRef = useRef(null);

  useEffect(() => {
    if (document.activeElement !== inputRef.current) {
      setInputValue(String(displayPercent));
    }
  }, [displayPercent]);

  const handleInputCommit = useCallback(() => {
    const num = parseInt(inputValue, 10);
    if (!isNaN(num) && num >= Math.round(LIGHTBOX_ZOOM_MIN * 100) && num <= Math.round(LIGHTBOX_ZOOM_MAX * 100)) {
      setScale(num / 100);
    }
    setInputValue(String(Math.round(scale * 100)));
  }, [inputValue, scale]);

  return (
    <div className="prd-lightbox prd-lightbox--enhanced" onMouseDown={handleBackdropMouseDown}>
      <div
        className="prd-lightbox-controls"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomOut} title="缩小">
          −
        </button>
        {LIGHTBOX_ZOOM_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            className={`prd-lightbox-controls__preset${scale === p ? ' prd-lightbox-controls__preset--active' : ''}`}
            onClick={() => handleZoomPreset(p)}
          >
            {Math.round(p * 100)}%
          </button>
        ))}
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomIn} title="放大">
          +
        </button>
        <input
          ref={inputRef}
          type="text"
          className="prd-lightbox-controls__input"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value.replace(/[^\d]/g, ''))}
          onBlur={handleInputCommit}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.target.blur(); } }}
          onFocus={(e) => e.target.select()}
        />
        <span className="prd-lightbox-controls__input-suffix">%</span>
        <button type="button" className="prd-lightbox-controls__btn" onClick={handleZoomReset} title="重置">
          重置
        </button>
        <button type="button" className="prd-lightbox-controls__btn prd-lightbox-controls__close" onClick={onClose} title="关闭">
          ✕
        </button>
      </div>

      {scale === null && (
        <div className="prd-lightbox-loading">
          <span className="prd-lightbox-loading__spinner" />
        </div>
      )}
      <div
        ref={contentRef}
        className="prd-lightbox-content"
        style={{
          transform: `translate(${translate.x}px, ${translate.y}px) scale(${scale ?? 1})`,
          cursor: dragging ? 'grabbing' : 'grab',
          visibility: scale === null ? 'hidden' : 'visible',
        }}
      >
        {imageSrc
          ? <img src={imageSrc} alt="放大查看" draggable={false} className="prd-lightbox-content__img" />
          : <div className="prd-lightbox-content__html" dangerouslySetInnerHTML={{ __html: htmlContent }} />
        }
      </div>
    </div>
  );
}

function AsyncDiagramSurface({
  className,
  hasContent,
  loading,
  loadingText,
  emptyText,
  interactive = false,
  onClick,
  children,
}) {
  return (
    <div
      className={className}
      style={{ cursor: interactive ? 'zoom-in' : 'default' }}
      onClick={interactive ? onClick : undefined}
    >
      {children}
      {loading && !hasContent && (
        <div className="prd-diagram-surface__overlay">
          <div className="prd-diagram-surface__empty">{loadingText}</div>
        </div>
      )}
      {!loading && !hasContent && (
        <div className="prd-diagram-surface__overlay">
          <div className="prd-diagram-surface__empty">{emptyText}</div>
        </div>
      )}
      {loading && hasContent && (
        <div className="prd-diagram-surface__badge">更新中…</div>
      )}
    </div>
  );
}

function MermaidRenderer({
  code,
  onCodeChange,
  viewMode = 'code',
  onViewModeChange,
  widthPx = null,
  onWidthChange,
  resizable = false,
}) {
  const [localViewMode, setLocalViewMode] = useState(viewMode);
  const [svgHtml, setSvgHtml] = useState('');
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [localWidthPx, setLocalWidthPx] = useState(widthPx);
  const [lightbox, setLightbox] = useState(false);
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const dragRef = useRef(null);
  const textareaRef = useRef(null);
  const viewMenuRef = useRef(null);
  const renderTaskRef = useRef(0);

  useEffect(() => { setLocalViewMode(viewMode); }, [viewMode]);
  useEffect(() => { setLocalWidthPx(widthPx); }, [widthPx]);

  useEffect(() => {
    if (localViewMode !== 'chart') {
      setRendering(false);
      return;
    }
    const currentCode = (code || '').trim();
    const renderTaskId = ++renderTaskRef.current;
    if (!currentCode) {
      setSvgHtml('');
      setRenderError('Mermaid 代码为空');
      setRendering(false);
      return;
    }
    let cancelled = false;
    const renderKey = `mermaid-${Date.now()}-${++_mermaidRenderSeq}`;
    setRendering(true);
    setRenderError('');
    getMermaidLib().then((mermaidLib) => mermaidLib.render(renderKey, currentCode)).then(
      ({ svg }) => {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml(svg);
          setRenderError('');
          setRendering(false);
        }
      },
      (err) => {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml('');
          setRenderError(String(err?.message || err));
          setRendering(false);
        }
      },
    );
    return () => { cancelled = true; };
  }, [code, localViewMode]);

  useEffect(() => {
    if (!showViewMenu) return;
    const handleClickOutside = (e) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) {
        setShowViewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [showViewMenu]);

  const handleViewModeSwitch = useCallback((mode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
    setShowViewMenu(false);
  }, [onViewModeChange]);

  const handleResizeMouseDown = useCallback((e, corner) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const rootEl = rootRef.current;
    if (!rootEl) return;
    const startW = rootEl.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startW, corner };

    const onMove = (ev) => {
      const { startX, startW: sw, corner: c } = dragRef.current;
      const dx = ev.clientX - startX;
      const delta = (c === 'nw' || c === 'sw') ? -dx : dx;
      const nextW = Math.max(160, Math.round(sw + delta));
      dragRef.current._lastW = nextW;
      setLocalWidthPx(nextW);
    };
    const onUp = () => {
      const finalW = dragRef.current?._lastW;
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (finalW != null) onWidthChange?.(finalW);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [resizable, onWidthChange]);

  const lines = (code || '').split('\n');
  const lineCount = Math.max(lines.length, 1);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const rootStyle = resizable && localWidthPx != null ? { width: localWidthPx } : {};

  return (
    <div
      ref={rootRef}
      className="prd-mermaid-renderer"
      style={rootStyle}
      data-prd-no-block-select
    >
      {/* 右上角视图切换 */}
      <div className="prd-mermaid-renderer__toolbar">
        <button
          type="button"
          className="prd-mermaid-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div ref={viewMenuRef} className="prd-mermaid-renderer__view-menu">
            <button
              type="button"
              className={`prd-mermaid-renderer__view-menu-item${localViewMode === 'code' ? ' prd-mermaid-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('code')}
            >
              仅展示代码{localViewMode === 'code' ? ' ✓' : ''}
            </button>
            <button
              type="button"
              className={`prd-mermaid-renderer__view-menu-item${localViewMode === 'chart' ? ' prd-mermaid-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('chart')}
            >
              仅展示图表{localViewMode === 'chart' ? ' ✓' : ''}
            </button>
          </div>
        )}
      </div>

      {/* 代码视图 */}
      {localViewMode === 'code' && (
        <div className="prd-mermaid-renderer__code-area">
          <div className="prd-mermaid-renderer__line-numbers" aria-hidden="true">
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mermaid-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mermaid-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            spellCheck={false}
            rows={lineCount}
          />
        </div>
      )}

      {/* 图表视图 */}
      {localViewMode === 'chart' && (
        <div className="prd-mermaid-renderer__chart-area" ref={chartRef}>
          {renderError ? (
            <div className="prd-mermaid-renderer__error">
              <FiAlertCircle size={16} />
              <span>Mermaid 图表无法渲染：{renderError}</span>
            </div>
          ) : (
            <AsyncDiagramSurface
              className="prd-mermaid-renderer__svg-wrap"
              hasContent={Boolean(svgHtml)}
              loading={rendering}
              loadingText="图表加载中…"
              emptyText="暂无图表内容"
              interactive={Boolean(svgHtml)}
              onClick={() => setLightbox(true)}
            >
              <div
                className="prd-mermaid-renderer__svg-canvas"
                aria-hidden={!svgHtml}
                dangerouslySetInnerHTML={{ __html: svgHtml }}
              />
            </AsyncDiagramSurface>
          )}
        </div>
      )}

      {/* 四角缩放 handle（仅顶层 block 可用） */}
      {resizable && ['nw', 'ne', 'sw', 'se'].map((corner) => (
        <div
          key={corner}
          className={`prd-mermaid-renderer__handle prd-mermaid-renderer__handle--${corner}`}
          onMouseDown={(e) => handleResizeMouseDown(e, corner)}
        />
      ))}

      {/* Lightbox：缩放 + 拖拽平移 */}
      {lightbox && svgHtml && createPortal(
        <PrdLightbox htmlContent={svgHtml} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </div>
  );
}

// ─── MindmapRenderer ──────────────────────────────────────────────────────────

const MERMAID_MINDMAP_RE = /^mindmap\s*\n/;

/**
 * 检测是否为 Mermaid mindmap 语法并转换为 Markdown 缩进列表。
 * Mermaid mindmap 格式：
 *   mindmap
 *     root((标题))
 *       子节点
 *         孙节点
 * 转换为：
 *   - 标题
 *     - 子节点
 *       - 孙节点
 */
function convertMermaidMindmapToMarkdown(code) {
  if (!MERMAID_MINDMAP_RE.test(code)) return null;
  const lines = code.split('\n').slice(1);
  if (!lines.length) return '';

  const SHAPE_RE = /^(.*?)(?:\(\(([^)]*)\)\)|\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})(.*)$/;

  let rootIndent = -1;
  const result = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const spaces = rawLine.match(/^(\s*)/)[1].length;
    let text = rawLine.trim();

    if (rootIndent < 0) {
      rootIndent = spaces;
    }

    const shapeMatch = text.match(SHAPE_RE);
    if (shapeMatch) {
      text = (shapeMatch[1] + (shapeMatch[2] ?? shapeMatch[3] ?? shapeMatch[4] ?? shapeMatch[5] ?? '') + shapeMatch[6]).trim();
    }

    const depth = Math.max(0, spaces - rootIndent);
    const indent = '  '.repeat(depth);
    result.push(`${indent}- ${text}`);
  }

  return result.join('\n');
}

function waitForNextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

async function renderMermaidSvgForExport(code) {
  const currentCode = (code || '').trim();
  if (!currentCode) {
    return { svgHtml: '', error: 'Mermaid 代码为空' };
  }
  try {
    const mermaidLib = await getMermaidLib();
    const renderKey = `mermaid-export-${Date.now()}-${++_mermaidRenderSeq}`;
    const { svg } = await mermaidLib.render(renderKey, currentCode);
    return { svgHtml: svg, error: '' };
  } catch (error) {
    return { svgHtml: '', error: String(error?.message || error) };
  }
}

async function renderMindmapSvgForExport(code) {
  let currentCode = (code || '').trim();
  const converted = convertMermaidMindmapToMarkdown(currentCode);
  if (converted !== null) currentCode = converted;
  if (!currentCode) {
    return { svgHtml: '', error: '思维导图代码为空' };
  }

  let host = null;
  let markmap = null;
  try {
    const { transformer, Markmap } = await getMarkmapDeps();
    const { root } = transformer.transform(currentCode);

    host = document.createElement('div');
    host.style.cssText = 'position:fixed;left:-10000px;top:-10000px;width:1200px;visibility:hidden;pointer-events:none;overflow:hidden;';
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    host.appendChild(svgEl);
    document.body.appendChild(host);

    const mmOptions = { autoFit: true, pan: false, zoom: false, duration: 0 };
    markmap = Markmap.create(svgEl, mmOptions, root);
    await waitForNextAnimationFrame();
    await waitForNextAnimationFrame();

    const g = svgEl.querySelector('g');
    const clone = svgEl.cloneNode(true);
    if (g) {
      const bbox = g.getBBox();
      if (bbox.width > 0 && bbox.height > 0) {
        const pad = 30;
        clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
        const cloneG = clone.querySelector('g');
        if (cloneG) cloneG.setAttribute('transform', '');
      }
    }
    clone.removeAttribute('width');
    clone.removeAttribute('height');
    clone.style.cssText = 'width:100%;height:auto;min-height:0';
    return { svgHtml: clone.outerHTML, error: '' };
  } catch (error) {
    return { svgHtml: '', error: String(error?.message || error) };
  } finally {
    try { markmap?.destroy?.(); } catch (_) { /* noop */ }
    host?.remove();
  }
}

function MindmapRenderer({
  code,
  onCodeChange,
  viewMode = 'code',
  onViewModeChange,
  widthPx = null,
  onWidthChange,
  resizable = false,
}) {
  const [localViewMode, setLocalViewMode] = useState(viewMode);
  const [svgHtml, setSvgHtml] = useState('');
  const [renderError, setRenderError] = useState('');
  const [rendering, setRendering] = useState(false);
  const [showViewMenu, setShowViewMenu] = useState(false);
  const [localWidthPx, setLocalWidthPx] = useState(widthPx);
  const [lightbox, setLightbox] = useState(false);
  const rootRef = useRef(null);
  const chartRef = useRef(null);
  const svgRef = useRef(null);
  const markmapRef = useRef(null);
  const dragRef = useRef(null);
  const textareaRef = useRef(null);
  const viewMenuRef = useRef(null);
  const renderTaskRef = useRef(0);

  useEffect(() => { setLocalViewMode(viewMode); }, [viewMode]);
  useEffect(() => { setLocalWidthPx(widthPx); }, [widthPx]);

  useEffect(() => {
    if (localViewMode !== 'chart') {
      setRendering(false);
      return;
    }
    let currentCode = (code || '').trim();
    const renderTaskId = ++renderTaskRef.current;

    const converted = convertMermaidMindmapToMarkdown(currentCode);
    if (converted !== null) {
      setRendering(false);
      onCodeChange?.(converted);
      return;
    }

    if (!currentCode) {
      setSvgHtml('');
      setRenderError('思维导图代码为空');
      setRendering(false);
      if (markmapRef.current) {
        try { markmapRef.current.destroy?.(); } catch (_) { /* noop */ }
        markmapRef.current = null;
      }
      return;
    }
    let cancelled = false;
    setRendering(true);
    setRenderError('');
    getMarkmapDeps().then(({ transformer, Markmap }) => {
      if (cancelled || renderTaskRef.current !== renderTaskId) return;
      try {
        const { root } = transformer.transform(currentCode);
        const svgEl = svgRef.current;
        if (!svgEl) throw new Error('思维导图挂载节点未就绪');
        const mmOptions = { autoFit: true, pan: false, zoom: false, duration: 0 };
        if (markmapRef.current) {
          markmapRef.current.setOptions(mmOptions);
          markmapRef.current.setData(root);
          markmapRef.current.fit();
        } else {
          markmapRef.current = Markmap.create(svgEl, mmOptions, root);
        }
        requestAnimationFrame(() => {
          if (cancelled || renderTaskRef.current !== renderTaskId || !svgEl) return;
          const g = svgEl.querySelector('g');
          const clone = svgEl.cloneNode(true);
          if (g) {
            const bbox = g.getBBox();
            const pad = 30;
            clone.setAttribute('viewBox', `${bbox.x - pad} ${bbox.y - pad} ${bbox.width + pad * 2} ${bbox.height + pad * 2}`);
            const cloneG = clone.querySelector('g');
            if (cloneG) cloneG.setAttribute('transform', '');
          }
          clone.removeAttribute('width');
          clone.removeAttribute('height');
          clone.style.cssText = 'width:100%;height:auto;min-height:0';
          setSvgHtml(clone.outerHTML);
          setRenderError('');
          setRendering(false);
        });
      } catch (err) {
        if (!cancelled && renderTaskRef.current === renderTaskId) {
          setSvgHtml('');
          setRenderError(String(err?.message || err));
          setRendering(false);
        }
      }
    }).catch((err) => {
      if (!cancelled && renderTaskRef.current === renderTaskId) {
        setSvgHtml('');
        setRenderError(String(err?.message || err));
        setRendering(false);
      }
    });
    return () => { cancelled = true; };
  }, [code, localViewMode, onCodeChange]);

  useEffect(() => {
    return () => {
      if (markmapRef.current) {
        try { markmapRef.current.destroy?.(); } catch (_) { /* noop */ }
        markmapRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!showViewMenu) return;
    const handleClickOutside = (e) => {
      if (viewMenuRef.current && !viewMenuRef.current.contains(e.target)) {
        setShowViewMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [showViewMenu]);

  const handleViewModeSwitch = useCallback((mode) => {
    setLocalViewMode(mode);
    onViewModeChange?.(mode);
    setShowViewMenu(false);
  }, [onViewModeChange]);

  const handleResizeMouseDown = useCallback((e, corner) => {
    if (!resizable) return;
    e.preventDefault();
    e.stopPropagation();
    const rootEl = rootRef.current;
    if (!rootEl) return;
    const startW = rootEl.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startW, corner };

    const onMove = (ev) => {
      const { startX, startW: sw, corner: c } = dragRef.current;
      const dx = ev.clientX - startX;
      const delta = (c === 'nw' || c === 'sw') ? -dx : dx;
      const nextW = Math.max(160, Math.round(sw + delta));
      dragRef.current._lastW = nextW;
      setLocalWidthPx(nextW);
    };
    const onUp = () => {
      const finalW = dragRef.current?._lastW;
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (finalW != null) onWidthChange?.(finalW);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [resizable, onWidthChange]);

  const lines = (code || '').split('\n');
  const lineCount = Math.max(lines.length, 1);
  const lineNumbers = Array.from({ length: lineCount }, (_, i) => i + 1);

  const rootStyle = resizable && localWidthPx != null ? { width: localWidthPx } : {};

  return (
    <div
      ref={rootRef}
      className="prd-mindmap-renderer"
      style={rootStyle}
      data-prd-no-block-select
    >
      <div className="prd-mindmap-renderer__toolbar">
        <button
          type="button"
          className="prd-mindmap-renderer__view-btn"
          onClick={() => setShowViewMenu((v) => !v)}
        >
          {localViewMode === 'code' ? <FiCode size={14} /> : <FiBarChart2 size={14} />}
          <span>视图</span>
        </button>
        {showViewMenu && (
          <div ref={viewMenuRef} className="prd-mindmap-renderer__view-menu">
            <button
              type="button"
              className={`prd-mindmap-renderer__view-menu-item${localViewMode === 'code' ? ' prd-mindmap-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('code')}
            >
              仅展示代码{localViewMode === 'code' ? ' ✓' : ''}
            </button>
            <button
              type="button"
              className={`prd-mindmap-renderer__view-menu-item${localViewMode === 'chart' ? ' prd-mindmap-renderer__view-menu-item--active' : ''}`}
              onClick={() => handleViewModeSwitch('chart')}
            >
              仅展示图表{localViewMode === 'chart' ? ' ✓' : ''}
            </button>
          </div>
        )}
      </div>

      {localViewMode === 'code' && (
        <div className="prd-mindmap-renderer__code-area">
          <div className="prd-mindmap-renderer__line-numbers" aria-hidden="true">
            {lineNumbers.map((n) => (
              <div key={n} className="prd-mindmap-renderer__line-number">{n}</div>
            ))}
          </div>
          <textarea
            ref={textareaRef}
            className="prd-mindmap-renderer__textarea"
            value={code || ''}
            onChange={(e) => onCodeChange?.(e.target.value)}
            spellCheck={false}
            rows={lineCount}
          />
        </div>
      )}

      {localViewMode === 'chart' && (
        <div className="prd-mindmap-renderer__chart-area" ref={chartRef}>
          {renderError ? (
            <div className="prd-mindmap-renderer__error">
              <FiAlertCircle size={16} />
              <span>思维导图无法渲染：{renderError}</span>
            </div>
          ) : (
            <AsyncDiagramSurface
              className="prd-mindmap-renderer__svg-wrap"
              hasContent={Boolean(svgHtml)}
              loading={rendering}
              loadingText="思维导图加载中…"
              emptyText="暂无思维导图内容"
              interactive={Boolean(svgHtml)}
              onClick={() => setLightbox(true)}
            >
              <svg
                ref={svgRef}
                style={{
                  width: '100%',
                  minHeight: 200,
                  visibility: svgHtml || rendering ? 'visible' : 'hidden',
                }}
              />
            </AsyncDiagramSurface>
          )}
        </div>
      )}

      {resizable && ['nw', 'ne', 'sw', 'se'].map((corner) => (
        <div
          key={corner}
          className={`prd-mindmap-renderer__handle prd-mindmap-renderer__handle--${corner}`}
          onMouseDown={(e) => handleResizeMouseDown(e, corner)}
        />
      ))}

      {lightbox && svgHtml && createPortal(
        <PrdLightbox htmlContent={svgHtml} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </div>
  );
}

// ─── ImageRenderer ───────────────────────────────────────────────────────────

/**
 * 渲染一個圖片 Element。
 * element: { type: 'image', src: string }
 * onUpdate(newElement) — 替換為新 element（例如貼上新圖片）
 * onDelete() — 清除此圖片（替換為空文字 element）
 * isSelected — 工具列是否常駐
 * onSelect() — 點擊時通知父層選中
 */
// 四角 resize handle 的位置定義
const RESIZE_HANDLES = ['nw', 'ne', 'sw', 'se'];

function ImageRenderer({
  element,
  onUpdate,
  onDelete,
  isSelected,
  onSelect,
  initialWidthPx,
  onWidthChange,
  onEnter,
  onMoveUp,
  onMoveDown,
  canMoveUp = false,
  canMoveDown = false,
  onAnnotate,
  annotationCount = 0,
}) {
  const [uploading, setUploading] = useState(false);
  const [lightbox, setLightbox] = useState(false);
  const [imgLoaded, setImgLoaded] = useState(false);
  // widthPx: null 表示尚未拖曳過，用 100% 自然寬度
  const [widthPx, setWidthPx] = useState(initialWidthPx ?? null);
  const [imgSrc, setImgSrc] = useState(element.src);
  const imgRef = useRef(null);
  const rootRef = useRef(null);
  const dragRef = useRef(null); // { startX, startW, corner }
  const retryCountRef = useRef(0);

  const showSelectedTools = isSelected && !uploading;

  useEffect(() => {
    setImgSrc(element.src);
    setImgLoaded(false);
    retryCountRef.current = 0;
  }, [element.src]);

  // 浏览器缓存命中时 onLoad 可能在 img 挂载前就已触发
  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setImgLoaded(true);
    }
  });

  useEffect(() => {
    if (isSelected) rootRef.current?.focus();
  }, [isSelected]);

  const handlePaste = useCallback(async (e) => {
    const file = getImageFromPaste(e);
    if (!file) return;
    e.preventDefault();
    e.stopPropagation();
    setUploading(true);
    try {
      const path = await uploadPastedImage(file);
      onUpdate({ type: 'image', src: path });
    } catch (err) {
      console.error('图片上传失败', err);
    } finally {
      setUploading(false);
    }
  }, [onUpdate]);

  // 拖曳開始
  const handleResizeMouseDown = useCallback((e, corner) => {
    e.preventDefault();
    e.stopPropagation();
    const img = imgRef.current;
    if (!img) return;
    const startW = img.getBoundingClientRect().width;
    dragRef.current = { startX: e.clientX, startW, corner };

    const onMove = (ev) => {
      const { startX, startW: sw, corner: c } = dragRef.current;
      const dx = ev.clientX - startX;
      // nw/sw 角向左拖是放大，ne/se 向右拖是放大
      const delta = (c === 'nw' || c === 'sw') ? -dx : dx;
      const nextW = Math.max(80, Math.round(sw + delta));
      dragRef.current._lastW = nextW;
      setWidthPx(nextW);
    };

    const onUp = () => {
      const finalW = dragRef.current?._lastW;
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      if (finalW != null) onWidthChange?.(finalW);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [onWidthChange]);

  const imgStyle = widthPx != null ? { width: widthPx } : { width: '100%' };

  return (
    <>
      <div
        ref={rootRef}
        className={[
          'prd-image-renderer',
          isSelected ? 'prd-image-renderer--selected' : '',
        ].filter(Boolean).join(' ')}
        tabIndex={0}
        onMouseDown={(e) => {
          const currentTarget = e.currentTarget;
          if (isSelected) {
            // 已選中時再點擊 → 開啟放大
            e.stopPropagation();
            setLightbox(true);
          } else {
            onSelect?.();
            requestAnimationFrame(() => currentTarget.focus());
          }
        }}
        onKeyDown={(e) => {
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
            e.preventDefault();
            e.stopPropagation();
            void copyImageToClipboard(imgSrc);
            return;
          }
          if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'x') {
            e.preventDefault();
            e.stopPropagation();
            void cutImageToClipboard(imgSrc, onDelete);
            return;
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            e.preventDefault();
            e.stopPropagation();
            onDelete?.();
            return;
          }
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            onEnter?.();
          }
        }}
        onPaste={handlePaste}
        data-prd-no-block-select
      >
        {uploading ? (
          <div className="prd-image-renderer__uploading">上传中…</div>
        ) : (
          <div className="prd-image-renderer__img-wrap">
            {!imgLoaded && (
              <div className="prd-image-renderer__loading">
                <div className="prd-image-renderer__loading-spinner" />
                <span>图片加载中…</span>
              </div>
            )}
            <img
              ref={imgRef}
              src={imgSrc}
              alt="图片"
              className="prd-image-renderer__img"
              style={{ ...imgStyle, ...(imgLoaded ? {} : { width: 0, height: 0, position: 'absolute', opacity: 0 }) }}
              draggable={false}
              onLoad={() => setImgLoaded(true)}
              onError={() => {
                if (retryCountRef.current >= 2 || !element.src) {
                  setImgLoaded(true);
                  return;
                }
                retryCountRef.current += 1;
                window.setTimeout(() => {
                  setImgSrc(`${element.src}${element.src.includes('?') ? '&' : '?'}t=${Date.now()}`);
                }, 300);
              }}
            />

            {/* 四角 resize handle */}
            {showSelectedTools && RESIZE_HANDLES.map((corner) => (
              <div
                key={corner}
                className={`prd-image-renderer__handle prd-image-renderer__handle--${corner}`}
                onMouseDown={(e) => handleResizeMouseDown(e, corner)}
              />
            ))}

            {/* 图片选中时显示图片操作；hover 仅显示单元格下方那一排操作 */}
            {showSelectedTools && (
              <div className="prd-image-renderer__overlay-toolbar">
                {onAnnotate && (
                  <button
                    type="button"
                    className="prd-action-btn prd-image-renderer__overlay-label"
                    title="标注"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      onAnnotate();
                    }}
                  >
                    标注{annotationCount > 0 ? `(${annotationCount})` : ''}
                  </button>
                )}
                <button
                  type="button"
                  className="prd-action-btn prd-image-renderer__overlay-btn"
                  title="上移"
                  disabled={!canMoveUp}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (canMoveUp) onMoveUp?.();
                  }}
                >
                  <BsArrowUpShort aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="prd-action-btn prd-image-renderer__overlay-btn"
                  title="下移"
                  disabled={!canMoveDown}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (canMoveDown) onMoveDown?.();
                  }}
                >
                  <BsArrowDownShort aria-hidden="true" />
                </button>
                <button
                  type="button"
                  className="prd-action-btn prd-action-btn--danger"
                  onMouseDown={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    onDelete();
                  }}
                >
                  删除
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Lightbox：缩放 + 拖拽平移 */}
      {lightbox && createPortal(
        <PrdLightbox imageSrc={imgSrc} onClose={() => setLightbox(false)} />,
        document.body,
      )}
    </>
  );
}

// ─── ElementRenderer ─────────────────────────────────────────────────────────

/**
 * 依 element.type 分發到對應渲染器。
 * blockId + cellPath 用於 globalSelection 定位。
 * cellPath: { ri, ci } — 表格格座標（非表格時為 null）
 */
function ElementRenderer({
  element,
  onUpdate,
  onDelete,
  onMoveUp,
  onMoveDown,
  canMoveUp,
  canMoveDown,
  blockId,
  cellPath = null,
  globalSelection,
  setGlobalSelection,
  onEnter,
  onBackspaceEmpty,
  onPasteImageAsBlock,
  onReplaceWithImage,
  onImageWidthChange,
  imageMeta,
  placeholder,
  onEditingFinished,
  /** 外層 block 類型（paragraph / h1–h7），表格格內不傳 */
  blockType,
  /** (nextType, markdown) => void */
  onBlockLevelChange,
  onAnnotate,
  annotationCount = 0,
  /** (newMd, startNum) => void — 有序列表从当前行以 startNum 重新 renumber */
  onResetOrderedStart,
  mermaidViewMode,
  onMermaidViewModeChange,
  mindmapViewMode,
  onMindmapViewModeChange,
}) {
  const isSelected = globalSelection?.type === 'image'
    && globalSelection.blockId === blockId
    && (cellPath == null
      ? globalSelection.cellPath == null
      : globalSelection.cellPath?.ri === cellPath?.ri
        && globalSelection.cellPath?.ci === cellPath?.ci
        && globalSelection.cellPath?.idx === cellPath?.idx);

  if (!element || element.type === 'text') {
    const isInCell = cellPath != null;
    return (
      <TiptapMarkdownEditor
        blockId={blockId}
        cellPath={cellPath}
        globalSelection={globalSelection}
        setGlobalSelection={setGlobalSelection}
        value={element?.markdown ?? ''}
        onSave={(v) => onUpdate({ type: 'text', markdown: v })}
        placeholder={placeholder || '点击此处填写内容（支持 Markdown）'}
        onEnter={onEnter}
        onBackspaceEmpty={onBackspaceEmpty}
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
        isSelected={isSelected}
        onSelect={() => setGlobalSelection?.({ type: 'image', blockId, cellPath })}
        initialWidthPx={imageMeta?.[element.src] ?? null}
        onWidthChange={(w) => onImageWidthChange?.(element.src, w)}
        onEnter={onEnter}
        onMoveUp={onMoveUp}
        onMoveDown={onMoveDown}
        canMoveUp={canMoveUp}
        canMoveDown={canMoveDown}
        onAnnotate={onAnnotate}
        annotationCount={annotationCount}
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
          viewMode={mindmapViewMode || 'code'}
          onViewModeChange={onMindmapViewModeChange}
          resizable={false}
        />
      </div>
    );
  }

  return null;
}

// ─── CellRenderer（表格格，支援貼上切換 element 類型）────────────────────────

/**
 * 對 cell elements 陣列做 renumber。
 * 從 changedIdx 所在的同層級有序列表群組開始重新編號。
 */
const getCellElementMd = (item) => item?.markdown || '';
const setCellElementMd = (item, markdown) => ({ ...item, markdown });
// 表格内列表只在 text element 之间连续，不跨 image element。
const getCellElementListType = (item) => (item?.type === 'text' ? item.type : null);

function hasOwnEnterField(payload, key) {
  return !!payload && typeof payload === 'object' && Object.prototype.hasOwnProperty.call(payload, key);
}

function getEnterCurrentMarkdown(payload) {
  if (typeof payload === 'string') return payload;
  if (hasOwnEnterField(payload, 'currentMarkdown')) return payload.currentMarkdown ?? '';
  return undefined;
}

function hasExplicitEnterNextMarkdown(payload) {
  return hasOwnEnterField(payload, 'nextMarkdown');
}

function getEnterNextMarkdown(payload) {
  if (typeof payload === 'string') return inferListPrefix(payload) ?? '';
  if (hasExplicitEnterNextMarkdown(payload)) return payload.nextMarkdown ?? '';
  const currentMarkdown = getEnterCurrentMarkdown(payload);
  return currentMarkdown ? (inferListPrefix(currentMarkdown) ?? '') : '';
}

function renumberCellElements(elements, changedIdx) {
  const el = elements[changedIdx];
  if (!el || el.type !== 'text') return elements;
  return renumberOrderedGroupAt(elements, changedIdx, createTypedMarkdownListOptions({
    anchorItem: el,
    getMarkdown: getCellElementMd,
    setMarkdown: setCellElementMd,
    getItemType: getCellElementListType,
  }));
}

function renumberCellElementsFrom(elements, changedIdx, startNum) {
  const el = elements[changedIdx];
  if (!el || el.type !== 'text') return elements;
  const md = getCellElementMd(el);
  const parsed = parseListPrefix(md);
  if (!parsed) return elements;
  const opts = createTypedMarkdownListOptions({
    anchorItem: el,
    getMarkdown: getCellElementMd,
    setMarkdown: setCellElementMd,
    getItemType: getCellElementListType,
  });
  const result = renumberOrderedItemsFrom(elements, changedIdx, parsed.indent, startNum, opts);
  return result ?? elements;
}

function isOrderedCellTextElementAt(elements, idx) {
  const el = elements[idx];
  if (!el || el.type !== 'text') return false;
  const parsed = parseListPrefix(getCellElementMd(el));
  return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

function maybeRenumberCellElementsAt(elements, idx) {
  if (!isOrderedCellTextElementAt(elements, idx)) return elements;
  return renumberCellElements(elements, idx);
}

function CellRenderer({
  cellElement,
  onUpdate,
  blockId,
  ri,
  ci,
  globalSelection,
  setGlobalSelection,
  rowBinding,
  annotationsDoc,
  onAnnotateUsage,
  hoverSuppressed = false,
  mermaidMeta,
  onMermaidMetaChange,
  mindmapMeta,
  onMindmapMetaChange,
}) {
  // 向下相容：舊格式 { element } 升級為 { elements: [] }
  const elements = useMemo(
    () => cellElement?.elements
      ?? (cellElement?.element ? [cellElement.element] : [{ type: 'text', markdown: '' }]),
    [cellElement],
  );

  // 新增容器後要聚焦的 index
  const [focusIdx, setFocusIdx] = useState(null);
  const [activeElementActionIdx, setActiveElementActionIdx] = useState(null);
  const containerRefs = useRef({});
  const activeElementActionIdxRef = useRef(null);
  const actionOpenTimerRef = useRef(null);
  const actionCloseTimerRef = useRef(null);
  const pendingActionIdxRef = useRef(null);
  const imageUsageByElementIdx = useMemo(() => {
    if (!rowBinding || ci !== rowBinding.designCi) return {};
    const map = {};
    let imageIdx = 0;
    elements.forEach((element, idx) => {
      if (element?.type !== 'image') return;
      const usage = rowBinding.usages?.find((item) => item.imageIndex === imageIdx);
      if (usage) map[idx] = usage;
      imageIdx += 1;
    });
    return map;
  }, [ci, elements, rowBinding]);

  useEffect(() => {
    if (focusIdx == null) return;
    const container = containerRefs.current[focusIdx];
    if (!container) return;
    const el = container.querySelector(
      'textarea, input, [contenteditable], .prd-editable-md--preview, .prd-image-renderer'
    );
    if (el) {
      el.click?.();
      el.focus?.();
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 聚焦後立即清除，避免重複觸發
    setFocusIdx(null);
  }, [focusIdx, elements.length]);

  useEffect(() => {
    activeElementActionIdxRef.current = activeElementActionIdx;
  }, [activeElementActionIdx]);

  const clearPendingElementActionOpen = useCallback((idx = null) => {
    if (idx != null && pendingActionIdxRef.current !== idx) return;
    if (actionOpenTimerRef.current) clearTimeout(actionOpenTimerRef.current);
    actionOpenTimerRef.current = null;
    if (idx == null || pendingActionIdxRef.current === idx) {
      pendingActionIdxRef.current = null;
    }
  }, []);

  const clearPendingElementActionClose = useCallback(() => {
    if (actionCloseTimerRef.current) clearTimeout(actionCloseTimerRef.current);
    actionCloseTimerRef.current = null;
  }, []);

  const requestElementActionOpen = useCallback((idx, { immediate = false } = {}) => {
    if (globalSelection != null || hoverSuppressed) return;
    clearPendingElementActionClose();
    const activeIdx = activeElementActionIdxRef.current;
    if (activeIdx === idx) {
      clearPendingElementActionOpen(idx);
      return;
    }
    const delay = immediate ? 0 : activeIdx != null ? ACTIONBAR_SWITCH_DELAY_MS : ACTIONBAR_OPEN_DELAY_MS;
    clearPendingElementActionOpen();
    pendingActionIdxRef.current = idx;
    const open = () => {
      if (pendingActionIdxRef.current !== idx) return;
      const container = containerRefs.current[idx];
      if (!isNodeHovered(container)) {
        pendingActionIdxRef.current = null;
        actionOpenTimerRef.current = null;
        return;
      }
      pendingActionIdxRef.current = null;
      actionOpenTimerRef.current = null;
      setActiveElementActionIdx(idx);
    };
    if (delay === 0) {
      open();
      return;
    }
    actionOpenTimerRef.current = setTimeout(open, delay);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

  const requestElementActionClose = useCallback((idx, { immediate = false } = {}) => {
    clearPendingElementActionOpen(idx);
    clearPendingElementActionClose();
    const close = () => {
      actionCloseTimerRef.current = null;
      setActiveElementActionIdx((curr) => (curr === idx ? null : curr));
    };
    if (immediate) {
      close();
      return;
    }
    actionCloseTimerRef.current = setTimeout(close, ACTIONBAR_CLOSE_DELAY_MS);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen]);

  const keepElementActionOpen = useCallback((idx) => {
    if (globalSelection != null || hoverSuppressed) return;
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    if (activeElementActionIdxRef.current !== idx) {
      setActiveElementActionIdx(idx);
    }
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

  useEffect(() => {
    if (activeElementActionIdx == null || globalSelection != null || hoverSuppressed) return undefined;
    const closeActiveAction = () => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      requestElementActionClose(idx, { immediate: true });
    };
    const handlePointerOutside = (event) => {
      const idx = activeElementActionIdxRef.current;
      if (idx == null) return;
      const container = containerRefs.current[idx];
      if (nodeContainsTarget(container, event.target)) return;
      closeActiveAction();
    };
    const handleWindowMouseOut = (event) => {
      if (event.relatedTarget == null) closeActiveAction();
    };
    document.addEventListener('mousemove', handlePointerOutside, true);
    document.addEventListener('mousedown', handlePointerOutside, true);
    window.addEventListener('blur', closeActiveAction);
    window.addEventListener('mouseout', handleWindowMouseOut);
    return () => {
      document.removeEventListener('mousemove', handlePointerOutside, true);
      document.removeEventListener('mousedown', handlePointerOutside, true);
      window.removeEventListener('blur', closeActiveAction);
      window.removeEventListener('mouseout', handleWindowMouseOut);
    };
  }, [activeElementActionIdx, globalSelection, hoverSuppressed, requestElementActionClose]);

  useEffect(() => () => {
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
  }, [clearPendingElementActionClose, clearPendingElementActionOpen]);

  useEffect(() => {
    if (globalSelection == null && !hoverSuppressed) return;
    clearPendingElementActionOpen();
    clearPendingElementActionClose();
    setActiveElementActionIdx(null);
  }, [clearPendingElementActionClose, clearPendingElementActionOpen, globalSelection, hoverSuppressed]);

  const updateElement = useCallback((idx, newEl) => {
    let next = elements.map((el, i) => i === idx ? newEl : el);
    next = renumberCellElements(next, idx);
    onUpdate({ elements: next });
  }, [elements, onUpdate]);

  const insertElementAfter = useCallback((idx, newEl) => {
    const next = [
      ...elements.slice(0, idx + 1),
      newEl,
      ...elements.slice(idx + 1),
    ];
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const insertElementBefore = useCallback((idx, newEl) => {
    const next = [
      ...elements.slice(0, idx),
      newEl,
      ...elements.slice(idx),
    ];
    onUpdate({ elements: next });
    setFocusIdx(idx);
  }, [elements, onUpdate]);

  const duplicateElementAfter = useCallback((idx) => {
    const duplicated = cloneSerializable(elements[idx]);
    let next = [
      ...elements.slice(0, idx + 1),
      duplicated,
      ...elements.slice(idx + 1),
    ];
    next = maybeRenumberCellElementsAt(next, idx + 1);
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const addElementAfter = useCallback((idx, enterPayload) => {
    const currentMarkdown = getEnterCurrentMarkdown(enterPayload);
    const nextMarkdown = getEnterNextMarkdown(enterPayload);
    const updatedCurrent = currentMarkdown !== undefined
      ? { ...elements[idx], type: 'text', markdown: currentMarkdown }
      : elements[idx];
    let next = [
      ...elements.slice(0, idx),
      updatedCurrent,
      { type: 'text', markdown: nextMarkdown },
      ...elements.slice(idx + 1),
    ];
    next = renumberCellElements(next, idx + 1);
    onUpdate({ elements: next });
    setFocusIdx(idx + 1);
  }, [elements, onUpdate]);

  const removeElement = useCallback((idx) => {
    if (elements.length <= 1) {
      onUpdate({ elements: [{ type: 'text', markdown: '' }] });
      return;
    }
    let next = elements.filter((_, i) => i !== idx);
    const neighborIdx = Math.min(idx, next.length - 1);
    if (neighborIdx >= 0) next = maybeRenumberCellElementsAt(next, neighborIdx);
    onUpdate({ elements: next });
    // 聚焦上一個容器
    setFocusIdx(Math.max(0, idx - 1));
  }, [elements, onUpdate]);

  const moveElement = useCallback((idx, direction) => {
    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= elements.length) return;
    const next = [...elements];
    [next[idx], next[targetIdx]] = [next[targetIdx], next[idx]];
    onUpdate({
      elements: maybeRenumberCellElementsAt(maybeRenumberCellElementsAt(next, idx), targetIdx),
    });
    setFocusIdx(targetIdx);
    if (elements[idx]?.type === 'image') {
      setGlobalSelection?.({ type: 'image', blockId, cellPath: { ri, ci, idx: targetIdx } });
    }
  }, [elements, onUpdate, setGlobalSelection, blockId, ri, ci]);

  const [elementInsertMenu, setElementInsertMenu] = useState(null);

  const handleElementInsert = useCallback((idx, direction, elType) => {
    let newEl;
    if (elType === 'mermaid') newEl = { type: 'mermaid', code: '' };
    else if (elType === 'mindmap') newEl = { type: 'mindmap', code: '' };
    else if (elType === 'image') newEl = { type: 'image', src: '' };
    else newEl = { type: 'text', markdown: '' };
    if (direction === 'above') {
      insertElementBefore(idx, newEl);
    } else {
      insertElementAfter(idx, newEl);
    }
    setElementInsertMenu(null);
  }, [insertElementAfter, insertElementBefore]);

  const getMermaidMetaKey = useCallback((idx) => {
    const el = elements[idx];
    return mermaidCodeToMetaKey(el?.code || '');
  }, [elements]);

  const getMindmapMetaKey = useCallback((idx) => {
    const el = elements[idx];
    return mindmapCodeToMetaKey(el?.code || '');
  }, [elements]);

  return (
    <div className="prd-cell-renderer">
      {elements.map((element, idx) => (
        <div
          className={[
            'prd-cell-element',
            activeElementActionIdx === idx ? 'prd-cell-element--action-active' : '',
          ].filter(Boolean).join(' ')}
          key={idx}
          ref={(el) => {
            if (el) containerRefs.current[idx] = el;
            else delete containerRefs.current[idx];
          }}
          onMouseEnter={() => requestElementActionOpen(idx)}
          onMouseLeave={() => requestElementActionClose(idx)}
        >
          <ActionPanel
            visible={globalSelection == null && activeElementActionIdx === idx}
            className="prd-cell-element__actions"
            onMouseEnter={() => keepElementActionOpen(idx)}
            onMouseLeave={() => requestElementActionClose(idx)}
          >
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              title="复制"
              onClick={() => duplicateElementAfter(idx)}
            >
              复制
            </button>
            <CellElementInsertButton
              label="上方插入"
              direction="above"
              idx={idx}
              isOpen={elementInsertMenu?.idx === idx && elementInsertMenu?.direction === 'above'}
              onToggle={() => setElementInsertMenu((prev) =>
                prev?.idx === idx && prev?.direction === 'above' ? null : { idx, direction: 'above' }
              )}
              onSelect={(elType) => handleElementInsert(idx, 'above', elType)}
              onClose={() => setElementInsertMenu(null)}
            />
            <CellElementInsertButton
              label="下方插入"
              direction="below"
              idx={idx}
              isOpen={elementInsertMenu?.idx === idx && elementInsertMenu?.direction === 'below'}
              onToggle={() => setElementInsertMenu((prev) =>
                prev?.idx === idx && prev?.direction === 'below' ? null : { idx, direction: 'below' }
              )}
              onSelect={(elType) => handleElementInsert(idx, 'below', elType)}
              onClose={() => setElementInsertMenu(null)}
            />
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              disabled={idx <= 0}
              title="上移"
              onClick={() => moveElement(idx, -1)}
            >
              上移
            </button>
            <button
              type="button"
              className="prd-action-btn prd-cell-element__action-btn"
              disabled={idx >= elements.length - 1}
              title="下移"
              onClick={() => moveElement(idx, 1)}
            >
              下移
            </button>
            <button
              type="button"
              className="prd-action-btn prd-action-btn--danger prd-cell-element__action-btn"
              title="删除"
              onClick={() => removeElement(idx)}
            >
              删除
            </button>
          </ActionPanel>
          <ElementRenderer
            element={element}
            onUpdate={(newEl) => updateElement(idx, newEl)}
            onDelete={() => removeElement(idx)}
            onMoveUp={() => moveElement(idx, -1)}
            onMoveDown={() => moveElement(idx, 1)}
            canMoveUp={idx > 0}
            canMoveDown={idx < elements.length - 1}
            blockId={blockId}
            cellPath={{ ri, ci, idx }}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={(currentMd) => addElementAfter(idx, currentMd)}
            onBackspaceEmpty={() => {
              if (idx > 0) removeElement(idx);
            }}
            onPasteImageAsBlock={(src) => insertElementAfter(idx, { type: 'image', src })}
            onReplaceWithImage={(src) => updateElement(idx, { type: 'image', src })}
            placeholder={idx === 0 ? '—' : ''}
            onAnnotate={imageUsageByElementIdx[idx] ? () => onAnnotateUsage?.(imageUsageByElementIdx[idx]) : undefined}
            annotationCount={imageUsageByElementIdx[idx]
              ? getUsageRegions(annotationsDoc, imageUsageByElementIdx[idx].usageId).length
              : 0}
            onResetOrderedStart={(newMd, startNum) => {
              let next = elements.map((el, i) => i === idx ? { ...el, markdown: newMd } : el);
              next = renumberCellElementsFrom(next, idx, startNum);
              onUpdate({ elements: next });
            }}
            mermaidViewMode={element.type === 'mermaid' ? (mermaidMeta?.mermaidViewModes?.[getMermaidMetaKey(idx)] || 'code') : undefined}
            onMermaidViewModeChange={element.type === 'mermaid' ? (mode) => {
              const key = getMermaidMetaKey(idx);
              onMermaidMetaChange?.('mermaidViewModes', key, mode);
            } : undefined}
            mindmapViewMode={element.type === 'mindmap' ? (mindmapMeta?.mindmapViewModes?.[getMindmapMetaKey(idx)] || 'code') : undefined}
            onMindmapViewModeChange={element.type === 'mindmap' ? (mode) => {
              const key = getMindmapMetaKey(idx);
              onMindmapMetaChange?.('mindmapViewModes', key, mode);
            } : undefined}
          />
        </div>
      ))}
    </div>
  );
}

function CellElementInsertButton({ label, direction, idx, isOpen, onToggle, onSelect, onClose }) {
  const menuRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) {
        onClose();
      }
    };
    document.addEventListener('mousedown', handleClickOutside, true);
    return () => document.removeEventListener('mousedown', handleClickOutside, true);
  }, [isOpen, onClose]);

  return (
    <div className="prd-cell-element__insert-wrap" ref={menuRef}>
      <button
        type="button"
        className={`prd-action-btn prd-cell-element__action-btn${isOpen ? ' prd-action-btn--active' : ''}`}
        title={label}
        onClick={onToggle}
      >
        {label}
      </button>
      {isOpen && (
        <div className={`prd-cell-element__insert-menu prd-cell-element__insert-menu--${direction}`}>
          {Object.entries(ELEMENT_TYPE_LABELS).map(([elType, elLabel]) => (
            <button
              key={elType}
              type="button"
              className="prd-cell-element__insert-menu-item"
              onClick={() => onSelect(elType)}
            >
              {elLabel}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Block 渲染組件 ──────────────────────────────────────────────────────────

function HeadingBlock({
  block, onUpdate, globalSelection, setGlobalSelection,
  onEnter, onBackspaceEmpty, setFocusBlockId, onEditingFinished,
}) {
  const tag = block.type; // h1 / ... / h7
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

function ParagraphBlock({
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

function DividerBlock() {
  return <hr className="prd-block-divider" />;
}

function MermaidBlock({
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

function MindmapBlock({
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

/** 選中列後「刪除列」浮層：依視窗上下翻轉 */
function TableColSelectorActions({ canDelete, onDelete }) {
  const { ref, vertical } = useViewportFit('below', 'left', { horizontal: false });
  return (
    <div
      ref={ref}
      className={[
        'prd-table-selector-actions',
        'prd-table-selector-actions--col',
        vertical === 'above' && 'prd-table-selector-actions--col--flip-v',
      ].filter(Boolean).join(' ')}
    >
      {canDelete && (
        <button
          type="button"
          className="prd-action-btn prd-action-btn--danger"
          onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
        >
          删除列
        </button>
      )}
    </div>
  );
}

/** 選中行後「刪除行」浮層：依視窗左右翻轉 */
function TableRowSelectorActions({ canDelete, onDelete }) {
  const { ref, horizontal } = useViewportFit('below', 'right', { vertical: false });
  return (
    <div
      ref={ref}
      className={[
        'prd-table-selector-actions',
        'prd-table-selector-actions--row',
        horizontal === 'left' && 'prd-table-selector-actions--row--flip-h',
      ].filter(Boolean).join(' ')}
    >
      {canDelete && (
        <button
          type="button"
          className="prd-action-btn prd-action-btn--danger"
          onMouseDown={(e) => { e.stopPropagation(); onDelete(); }}
        >
          删除行
        </button>
      )}
    </div>
  );
}

function CellChangeIntentButton({ unchanged, onToggle }) {
  return (
    <button
      type="button"
      className={[
        'prd-table-cell-change-intent',
        unchanged ? 'prd-table-cell-change-intent--active' : '',
      ].filter(Boolean).join(' ')}
      title={unchanged ? '仅参考，不修改' : '设为仅参考，不修改'}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
        onToggle();
      }}
    >
      仅参考
    </button>
  );
}

function CellPendingConfirmControl({
  active,
  note,
  onActivate,
  onDeactivate,
  onSaveNote,
}) {
  const rootRef = useRef(null);
  const { ref: popoverRef, vertical, horizontal } = useViewportFit('below', 'right');
  const [open, setOpen] = useState(false);
  const [draftNote, setDraftNote] = useState(note || '');

  const commitDraftAndClose = useCallback(() => {
    onSaveNote?.(draftNote);
    setOpen(false);
  }, [draftNote, onSaveNote]);

  useEffect(() => {
    if (!open) return;
    setDraftNote(note || '');
  }, [note, open]);

  useEffect(() => {
    if (!open) return undefined;
    const handlePointerDown = (event) => {
      if (rootRef.current?.contains(event.target)) return;
      commitDraftAndClose();
    };
    const handleKeyDown = (event) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      commitDraftAndClose();
    };
    document.addEventListener('mousedown', handlePointerDown, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [commitDraftAndClose, open]);

  const handleOpen = useCallback(() => {
    if (!active) onActivate?.();
    setOpen(true);
  }, [active, onActivate]);

  const handleDeactivate = useCallback(() => {
    onDeactivate?.();
    setDraftNote('');
    setOpen(false);
  }, [onDeactivate]);

  return (
    <div className="prd-table-cell-pending-confirm" ref={rootRef}>
      <button
        type="button"
        className={[
          'prd-table-cell-pending-confirm__tag',
          active ? 'prd-table-cell-pending-confirm__tag--active' : '',
        ].filter(Boolean).join(' ')}
        title={active
          ? (note ? `待确认：${note}` : '待确认，点击补充备注')
          : '标记为待确认'}
        onMouseDown={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
        onClick={handleOpen}
      >
        待确认
      </button>
      {open && (
        <div
          ref={popoverRef}
          className={[
            'prd-table-cell-note-popover',
            vertical === 'above' ? 'prd-table-cell-note-popover--above' : '',
            horizontal === 'left' ? 'prd-table-cell-note-popover--align-left' : '',
          ].filter(Boolean).join(' ')}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="prd-table-cell-note-popover__title">待确认备注</div>
          <textarea
            className="prd-table-cell-note-popover__textarea"
            rows={4}
            autoFocus
            placeholder="记录后续要确认的细节点，方便下次继续查看。"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value)}
          />
          <div className="prd-table-cell-note-popover__actions">
            <button
              type="button"
              className="prd-action-btn"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={handleDeactivate}
            >
              取消标记
            </button>
            <button
              type="button"
              className="prd-action-btn prd-action-btn--active"
              onMouseDown={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={commitDraftAndClose}
            >
              完成
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── TableBlock（hover 行/列边条选中 + 插入 handle）────────────────────────
// renderCell(ri, ci, value, onSave, header) → ReactNode  （可选，默认 PastableCell）
// lockHeaders: true 时表头不可编辑（用于 PrdSectionBlock）

/**
 * 表格行列选中由 PrdPage 全局 globalSelection 持有，全页仅一处；
 * 选中表格式目标时抑制其他表格的 bar hover 与插入把手。
 */
function TableBlock({
  block,
  onUpdate,
  lockHeaders = false,
  globalSelection,
  setGlobalSelection,
  setActiveActionBlockId,
  rowBindings = [],
  annotationsDoc,
  onAnnotateUsage,
  onSetCellChangeIntent,
  onSetCellPendingConfirm,
  onSetCellPendingConfirmNote,
  onCellEdited,
  hoverSuppressed = false,
  mermaidMeta,
  onMermaidMetaChange,
  mindmapMeta,
  onMindmapMetaChange,
}) {
  const { headers, rows } = block.content;
  const selectedCol = globalSelection?.blockId === block.id && globalSelection.type === 'table-col'
    ? globalSelection.ci : null;
  const selectedRow = globalSelection?.blockId === block.id && globalSelection.type === 'table-row'
    ? globalSelection.ri : null;
  const [colEdge, setColEdge] = useState(null); // 列边界插入 handle
  const [rowEdge, setRowEdge] = useState(null); // 行边界插入 handle
  const [showHoverBars, setShowHoverBars] = useState(false);
  /** 列/行 bar 定位（避免每帧 querySelector 量表） */
  const [tableGeom, setTableGeom] = useState(null);
  const tableRef = useRef(null);
  const wrapRef = useRef(null);
  const hoverHideTimerRef = useRef(null);
  const hoverEdgeFrameRef = useRef(null);
  const hoverEdgeRef = useRef({ col: null, row: null });
  const pendingHoverEdgeRef = useRef({ col: null, row: null });
  const tableMeasureFrameRef = useRef(null);

  const flushHoverEdges = useCallback((nextCol, nextRow) => {
    if (hoverEdgeRef.current.col !== nextCol) {
      hoverEdgeRef.current.col = nextCol;
      setColEdge(nextCol);
    }
    if (hoverEdgeRef.current.row !== nextRow) {
      hoverEdgeRef.current.row = nextRow;
      setRowEdge(nextRow);
    }
  }, []);

  const scheduleHoverEdges = useCallback((nextCol, nextRow) => {
    pendingHoverEdgeRef.current = { col: nextCol, row: nextRow };
    if (hoverEdgeFrameRef.current != null) return;
    hoverEdgeFrameRef.current = requestAnimationFrame(() => {
      hoverEdgeFrameRef.current = null;
      flushHoverEdges(pendingHoverEdgeRef.current.col, pendingHoverEdgeRef.current.row);
    });
  }, [flushHoverEdges]);

  const openHoverBars = useCallback(() => {
    if (globalSelection != null || hoverSuppressed) return;
    if (hoverHideTimerRef.current) {
      clearTimeout(hoverHideTimerRef.current);
      hoverHideTimerRef.current = null;
    }
    setShowHoverBars(true);
  }, [globalSelection, hoverSuppressed]);

  const closeHoverBarsWithDelay = useCallback(() => {
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    hoverHideTimerRef.current = setTimeout(() => {
      setShowHoverBars(false);
      flushHoverEdges(null, null);
      hoverHideTimerRef.current = null;
    }, TABLE_HOVER_CLOSE_DELAY_MS);
  }, [flushHoverEdges]);

  useEffect(() => () => {
    if (hoverHideTimerRef.current) clearTimeout(hoverHideTimerRef.current);
    if (hoverEdgeFrameRef.current != null) cancelAnimationFrame(hoverEdgeFrameRef.current);
    if (tableMeasureFrameRef.current != null) cancelAnimationFrame(tableMeasureFrameRef.current);
  }, []);

  useEffect(() => {
    if (globalSelection == null && !hoverSuppressed) return;
    if (showHoverBars) setShowHoverBars(false);
    flushHoverEdges(null, null);
  }, [flushHoverEdges, globalSelection, hoverSuppressed, showHoverBars]);

  const measureTable = useCallback(() => {
    const table = tableRef.current;
    if (!table) return;
    measurePrdTask('table-measure', () => {
      const ths = table.querySelectorAll('thead tr th');
      const colLeft = [];
      const colWidth = [];
      const colRight = [];
      let x = 0;
      for (let i = 0; i < ths.length; i++) {
        colLeft.push(x);
        const w = ths[i].offsetWidth;
        colWidth.push(w);
        colRight.push(x + w);
        x += w;
      }
      const thead = table.querySelector('thead');
      const theadH = thead ? thead.offsetHeight : 0;
      const trs = table.querySelectorAll('tbody tr');
      const rowTop = [];
      const rowHeight = [];
      const rowBottom = [];
      let y = theadH;
      for (let i = 0; i < trs.length; i++) {
        rowTop.push(y);
        const h = trs[i].offsetHeight;
        rowHeight.push(h);
        rowBottom.push(y + h);
        y += h;
      }
      const nextGeom = { colLeft, colWidth, colRight, rowTop, rowHeight, rowBottom };
      setTableGeom((prev) => (sameTableGeom(prev, nextGeom) ? prev : nextGeom));
    }, { headerCount: headers.length, rowCount: rows.length });
  }, [headers.length, rows.length]);

  const scheduleTableMeasure = useCallback(() => {
    if (tableMeasureFrameRef.current != null) return;
    tableMeasureFrameRef.current = requestAnimationFrame(() => {
      tableMeasureFrameRef.current = null;
      measureTable();
    });
  }, [measureTable]);

  useLayoutEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 量测在 rAF 中合并，避免多次同步布局抖动
    scheduleTableMeasure();
  }, [scheduleTableMeasure, headers.length, rows.length, block.content]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      scheduleTableMeasure();
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [scheduleTableMeasure]);

  const clearThisTableSelection = useCallback(() => {
    setGlobalSelection((prev) => {
      if (!prev || prev.blockId !== block.id) return prev;
      return isTableKindSelection(prev) ? null : prev;
    });
  }, [block.id, setGlobalSelection]);

  const clearOtherUiStateForTableAction = useCallback(() => {
    setActiveActionBlockId(null);
    setGlobalSelection(null);
    const activeEl = document.activeElement;
    if (activeEl instanceof HTMLElement && activeEl !== document.body) {
      activeEl.blur();
    }
  }, [setActiveActionBlockId, setGlobalSelection]);

  const selectCol = useCallback((ci) => {
    clearOtherUiStateForTableAction();
    setGlobalSelection({ blockId: block.id, type: 'table-col', ci });
  }, [block.id, setGlobalSelection, clearOtherUiStateForTableAction]);

  const selectRow = useCallback((ri) => {
    clearOtherUiStateForTableAction();
    setGlobalSelection({ blockId: block.id, type: 'table-row', ri });
  }, [block.id, setGlobalSelection, clearOtherUiStateForTableAction]);

  // 把舊格式升級為新格式 { elements: Element[] }（向下相容）
  const normRows = rows.map((row) =>
    row.map((cell) => {
      if (cell && typeof cell === 'object' && Array.isArray(cell.elements)) return cell;
      // 舊格式 { element: Element } → 升級
      if (cell && typeof cell === 'object' && 'element' in cell) {
        return { elements: [cell.element] };
      }
      // 更舊格式：string
      const s = cell || '';
      const imgMatch = s.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
      if (imgMatch) return { elements: [{ type: 'image', src: imgMatch[2] }] };
      return { elements: [{ type: 'text', markdown: s }] };
    })
  );

  const updateCell = (ri, ci, newCellEl) => {
    const newRows = normRows.map((r, i) => i === ri ? r.map((c, j) => j === ci ? newCellEl : c) : r);
    onUpdate({ ...block, content: { ...block.content, rows: newRows } });
    const rowBinding = rowBindings[ri];
    const columnKey = getCellColumnKey(headers, ci);
    if (rowBinding && (columnKey === 'interaction' || columnKey === 'logic')) {
      onCellEdited?.(rowBinding.rowKey, rowBinding.usages?.[0]?.usageId || '', columnKey);
    }
  };
  const updateHeader = (ci, v) => {
    const newHeaders = headers.map((h, i) => i === ci ? v : h);
    onUpdate({ ...block, content: { ...block.content, headers: newHeaders } });
  };
  const insertRowAfter = (ri) => {
    clearOtherUiStateForTableAction();
    const newRows = [...normRows];
    newRows.splice(ri + 1, 0, Array(headers.length).fill(null).map(makeEmptyCell));
    onUpdate({ ...block, content: { ...block.content, rows: newRows } });
    clearThisTableSelection();
  };
  const insertColAfter = (ci) => {
    clearOtherUiStateForTableAction();
    const emptyCell = makeEmptyCell;
    onUpdate({
      ...block,
      content: {
        ...block.content,
        headers: [...headers.slice(0, ci + 1), '新列名', ...headers.slice(ci + 1)],
        rows: normRows.map((r) => [...r.slice(0, ci + 1), emptyCell(), ...r.slice(ci + 1)]),
      },
    });
    clearThisTableSelection();
  };
  const deleteRow = (ri) => {
    if (normRows.length <= 1) return;
    clearOtherUiStateForTableAction();
    onUpdate({ ...block, content: { ...block.content, rows: normRows.filter((_, i) => i !== ri) } });
    clearThisTableSelection();
  };
  const deleteCol = (ci) => {
    if (headers.length <= 1) return;
    clearOtherUiStateForTableAction();
    onUpdate({
      ...block,
      content: {
        ...block.content,
        headers: headers.filter((_, i) => i !== ci),
        rows: normRows.map((r) => r.filter((_, i) => i !== ci)),
      },
    });
    clearThisTableSelection();
  };

  const gColLeft = (ci) => tableGeom?.colLeft[ci] ?? 0;
  const gColWidth = (ci) => tableGeom?.colWidth[ci] ?? 0;
  const gColRight = (ci) => tableGeom?.colRight[ci] ?? 0;
  const gRowTop = (ri) => tableGeom?.rowTop[ri] ?? 0;
  const gRowHeight = (ri) => tableGeom?.rowHeight[ri] ?? 0;
  const gRowBottom = (ri) => tableGeom?.rowBottom[ri] ?? 0;

  const foreignSel = globalSelection != null && globalSelection.blockId !== block.id
    && isTableKindSelection(globalSelection);
  const localSel = globalSelection != null && globalSelection.blockId === block.id
    && isTableKindSelection(globalSelection);
  const suppressHandles = globalSelection != null;

  // 用 normRows 替代 rows 做渲染
  const displayRows = normRows;

  return (
    <div className="prd-block-table">
      <div
        ref={wrapRef}
        className={[
          'prd-table-wrap',
          'prd-block-table__wrap',
          showHoverBars ? 'prd-block-table__wrap--show-bars' : '',
          foreignSel ? 'prd-block-table__wrap--foreign-selection' : '',
          localSel ? 'prd-block-table__wrap--has-selection' : '',
        ].filter(Boolean).join(' ')}
        onMouseEnter={openHoverBars}
        onMouseLeave={closeHoverBarsWithDelay}
      >
        <table
          className="prd-table"
          ref={tableRef}
        >
          <colgroup>{headers.map((_, i) => <col key={i} />)}</colgroup>
          <thead>
            <tr>
              {headers.map((h, ci) => {
                return (
                <th
                  key={ci}
                  scope="col"
                  className={[
                    selectedCol === ci ? 'prd-table-col--selected' : '',
                  ].filter(Boolean).join(' ')}
                  onMouseDownCapture={(e) => {
                    if (e.target.closest('.prd-editable, .prd-editable-md')) return;
                    if (localSel) clearThisTableSelection();
                  }}
                  onMouseMove={(e) => {
                    if (suppressHandles) return;
                    const rect = e.currentTarget.getBoundingClientRect();
                    const nextColEdge = resolveBoundaryHoverIndex(
                      e.clientX - rect.left,
                      rect.width,
                      ci,
                      ci > 0,
                    );
                    scheduleHoverEdges(nextColEdge, hoverEdgeRef.current.row);
                  }}
                  onMouseLeave={() => scheduleHoverEdges(null, hoverEdgeRef.current.row)}
                >
                  {lockHeaders
                    ? h
                    : (
                      <TiptapMarkdownEditor
                        value={h}
                        onSave={(v) => updateHeader(ci, v)}
                        placeholder="列名称"
                        blockId={block.id}
                        selectionRole={`th-${ci}`}
                        globalSelection={globalSelection}
                        setGlobalSelection={setGlobalSelection}
                        singleLine
                      />
                    )}
                </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {displayRows.map((row, ri) => {
              const rowBinding = rowBindings[ri];
              const rowCellState = rowBinding ? getCellState(annotationsDoc, rowBinding.rowKey) : null;
              return (
              <tr
                key={ri}
                className={selectedRow === ri ? 'prd-table-row--selected' : ''}
              >
                {headers.map((h, ci) => {
                  const columnKey = getCellColumnKey(headers, ci);
                  const cellState = rowCellState;
                  const isLockable = columnKey === 'interaction' || columnKey === 'logic';
                  const unchanged = cellState?.[columnKey]?.changeIntent === 'unchanged';
                  const pendingConfirm = Boolean(cellState?.[columnKey]?.pendingConfirm);
                  const pendingConfirmNote = cellState?.[columnKey]?.pendingConfirmNote || '';
                  return (
                  <td
                    key={ci}
                    data-prd-label={h}
                    className={[
                      selectedCol === ci ? 'prd-table-col--selected' : '',
                      unchanged ? 'prd-table-cell--unchanged' : '',
                      pendingConfirm ? 'prd-table-cell--pending-confirm' : '',
                    ].filter(Boolean).join(' ')}
                    onMouseDownCapture={(e) => {
                      // 預覽與編輯態 class 不同，統一用 .prd-editable-md
                      if (e.target.closest('.prd-editable-md')) return;
                      if (localSel) clearThisTableSelection();
                    }}
                    onMouseMove={(e) => {
                      if (suppressHandles) return;
                      const rect = e.currentTarget.getBoundingClientRect();
                      const nextRowEdge = resolveBoundaryHoverIndex(
                        e.clientY - rect.top,
                        rect.height,
                        ri,
                        ri > 0,
                      );
                      const nextColEdge = resolveBoundaryHoverIndex(
                        e.clientX - rect.left,
                        rect.width,
                        ci,
                        ci > 0,
                      );
                      scheduleHoverEdges(nextColEdge, nextRowEdge);
                    }}
                  >
                    {isLockable && rowBinding && (
                      <div className="prd-table-cell-controls">
                        <CellPendingConfirmControl
                          active={pendingConfirm}
                          note={pendingConfirmNote}
                          onActivate={() => onSetCellPendingConfirm?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            true,
                          )}
                          onDeactivate={() => onSetCellPendingConfirm?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            false,
                          )}
                          onSaveNote={(nextNote) => onSetCellPendingConfirmNote?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            nextNote,
                          )}
                        />
                        <CellChangeIntentButton
                          unchanged={unchanged}
                          onToggle={() => onSetCellChangeIntent?.(
                            rowBinding.rowKey,
                            rowBinding.usages?.[0]?.usageId || '',
                            columnKey,
                            unchanged ? 'default' : 'unchanged',
                          )}
                        />
                      </div>
                    )}
                    <CellRenderer
                      cellElement={row[ci]}
                      onUpdate={(newCellEl) => updateCell(ri, ci, newCellEl)}
                      blockId={block.id}
                      ri={ri}
                      ci={ci}
                      globalSelection={globalSelection}
                      setGlobalSelection={setGlobalSelection}
                      rowBinding={rowBinding}
                      annotationsDoc={annotationsDoc}
                      onAnnotateUsage={onAnnotateUsage}
                      hoverSuppressed={hoverSuppressed}
                      mermaidMeta={mermaidMeta}
                      onMermaidMetaChange={onMermaidMetaChange}
                      mindmapMeta={mindmapMeta}
                      onMindmapMetaChange={onMindmapMetaChange}
                    />
                  </td>
                  );
                })}
              </tr>
              );
            })}
          </tbody>
        </table>

        {/* ── 列顶部 selector bar（鼠标在表格内时始终显示所有列的 bar） ── */}
        {headers.map((_, ci) => (
          <div
            key={`col-bar-${ci}`}
            className={`prd-table-col-bar${selectedCol === ci ? ' prd-table-col-bar--selected' : ''}`}
            style={{ left: gColLeft(ci), width: gColWidth(ci) }}
            onMouseEnter={openHoverBars}
            onMouseLeave={closeHoverBarsWithDelay}
            onMouseDown={(e) => {
              e.preventDefault();
              if (selectedCol === ci) clearThisTableSelection();
              else selectCol(ci);
            }}
          >
            {selectedCol === ci && (
              <TableColSelectorActions
                canDelete={headers.length > 1}
                onDelete={() => deleteCol(ci)}
              />
            )}
          </div>
        ))}

        {/* ── 行左侧 selector bar（鼠标在表格内时始终显示所有行的 bar） ── */}
        {displayRows.map((_, ri) => (
          <div
            key={`row-bar-${ri}`}
            className={`prd-table-row-bar${selectedRow === ri ? ' prd-table-row-bar--selected' : ''}`}
            style={{ top: gRowTop(ri), height: gRowHeight(ri) }}
            onMouseEnter={openHoverBars}
            onMouseLeave={closeHoverBarsWithDelay}
            onMouseDown={(e) => {
              e.preventDefault();
              if (selectedRow === ri) clearThisTableSelection();
              else selectRow(ri);
            }}
          >
            {selectedRow === ri && (
              <TableRowSelectorActions
                canDelete={rows.length > 1}
                onDelete={() => deleteRow(ri)}
              />
            )}
          </div>
        ))}


        {colEdge !== null && !suppressHandles && (
          <div
            className="prd-table-col-handle"
            style={{ left: gColRight(colEdge) }}
            onMouseEnter={() => flushHoverEdges(colEdge, hoverEdgeRef.current.row)}
            onMouseLeave={() => flushHoverEdges(null, hoverEdgeRef.current.row)}
          >
            <div className="prd-table-col-handle__line" />
            <button
              className="prd-table-handle__btn"
              title="插入列"
              onMouseDown={(e) => { e.preventDefault(); insertColAfter(colEdge); }}
            >＋</button>
          </div>
        )}

        {rowEdge !== null && !suppressHandles && (
          <div
            className="prd-table-row-handle"
            style={{ top: gRowBottom(rowEdge) }}
            onMouseEnter={() => flushHoverEdges(hoverEdgeRef.current.col, rowEdge)}
            onMouseLeave={() => flushHoverEdges(hoverEdgeRef.current.col, null)}
          >
            <div className="prd-table-row-handle__line" />
            <button
              className="prd-table-handle__btn"
              title="插入行"
              onMouseDown={(e) => { e.preventDefault(); insertRowAfter(rowEdge); }}
            >＋</button>
          </div>
        )}
      </div>
    </div>
  );
}

const PRD_SECTION_HEADERS = ['设计/原型稿', '交互', '逻辑'];

// ─── 插入 Block 選單 ─────────────────────────────────────────────────────────

function AddBlockMenu({ onAdd, onClose, position = 'below' }) {
  const clickRef = useRef(null);
  const [openGroupId, setOpenGroupId] = useState(null);
  const [submenuVertical, setSubmenuVertical] = useState('below');
  const groupRefs = useRef({});
  const submenuRefs = useRef({});
  const preferred = position === 'above' ? 'above' : 'below';
  const { ref: fitRef, vertical, horizontal } = useViewportFit(preferred, 'left');
  const submenuDirection = horizontal === 'right' ? 'left' : 'right';

  const setMenuRef = useCallback((el) => {
    clickRef.current = el;
    fitRef.current = el;
  }, [fitRef]);

  useEffect(() => {
    const handler = (e) => { if (clickRef.current && !clickRef.current.contains(e.target)) onClose(); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  useLayoutEffect(() => {
    if (!openGroupId) return;
    const groupNode = groupRefs.current[openGroupId];
    const submenuNode = submenuRefs.current[openGroupId];
    if (!groupNode || !submenuNode) return;
    const groupRect = groupNode.getBoundingClientRect();
    const submenuRect = submenuNode.getBoundingClientRect();
    const viewportHeight = window.innerHeight;
    const margin = 8;
    const availableBelow = viewportHeight - groupRect.top - margin;
    const availableAbove = groupRect.bottom - margin;
    const fitsBelow = submenuRect.height <= availableBelow;
    const fitsAbove = submenuRect.height <= availableAbove;

    if (!fitsBelow && (fitsAbove || availableAbove > availableBelow)) {
      setSubmenuVertical('above');
    } else {
      setSubmenuVertical('below');
    }
  }, [openGroupId]);

  const items = [
    {
      id: 'text-blocks',
      type: 'group',
      label: '文本块',
      children: ['paragraph', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'h7'],
    },
    { id: 'table', type: 'item', value: 'table' },
    { id: 'mermaid', type: 'item', value: 'mermaid' },
    { id: 'mindmap', type: 'item', value: 'mindmap' },
    { id: 'prd-section-template', type: 'item', value: 'prd-section-template' },
    { id: 'divider', type: 'item', value: 'divider' },
  ];

  return (
    <div
      ref={setMenuRef}
      className={[
        'prd-add-menu',
        `prd-add-menu--${vertical}`,
        horizontal === 'right' ? 'prd-add-menu--align-right' : '',
      ].filter(Boolean).join(' ')}
    >
      {items.map((item) => {
        if (item.type === 'group') {
          const expanded = openGroupId === item.id;
          return (
            <div
              key={item.id}
              className="prd-add-menu__group"
              ref={(node) => {
                if (node) groupRefs.current[item.id] = node;
                else delete groupRefs.current[item.id];
              }}
              onMouseEnter={() => setOpenGroupId(item.id)}
              onMouseLeave={() => setOpenGroupId((curr) => (curr === item.id ? null : curr))}
            >
              <button
                type="button"
                className={[
                  'prd-add-menu__item',
                  'prd-add-menu__item--branch',
                  expanded ? 'prd-add-menu__item--branch-active' : '',
                ].filter(Boolean).join(' ')}
              >
                <span>{item.label}</span>
                <span className="prd-add-menu__item-caret" aria-hidden="true">
                  {submenuDirection === 'right' ? '>' : '<'}
                </span>
              </button>
              <div
                ref={(node) => {
                  if (node) submenuRefs.current[item.id] = node;
                  else delete submenuRefs.current[item.id];
                }}
                className={[
                  'prd-add-menu__submenu',
                  submenuVertical === 'above' ? 'prd-add-menu__submenu--above' : '',
                  submenuDirection === 'left' ? 'prd-add-menu__submenu--left' : '',
                  expanded ? 'prd-add-menu__submenu--open' : '',
                ].filter(Boolean).join(' ')}
              >
                {item.children.map((child) => (
                  <button
                    key={child}
                    type="button"
                    className="prd-add-menu__item"
                    onClick={() => {
                      onAdd(child);
                      onClose();
                    }}
                  >
                    {BLOCK_TYPE_LABELS[child]}
                  </button>
                ))}
              </div>
            </div>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            className="prd-add-menu__item"
            onClick={() => {
              onAdd(item.value);
              onClose();
            }}
          >
            {BLOCK_TYPE_LABELS[item.value]}
          </button>
        );
      })}
    </div>
  );
}

const makeEmptyCell = () => ({ elements: [{ type: 'text', markdown: '' }] });
const makeEmptyRow = (colCount) => Array(colCount).fill(null).map(makeEmptyCell);

// ─── 主文档列表链路工具 ─────────────────────────────────────────────────────

/** 取得 block 的 markdown 內容 */
function getBlockMd(block) {
  return block?.content?.markdown ?? '';
}

function isMainDocTextListBlock(block) {
  if (!block) return false;
  if (/^h[1-7]$/.test(block.type)) return true;
  return block.type === 'paragraph' && block.content?.type === 'text';
}

function getMainDocTextListType(block) {
  if (!block) return null;
  if (/^h[1-7]$/.test(block.type)) return block.type;
  if (block.type === 'paragraph' && block.content?.type === 'text') return block.type;
  return null;
}

function setBlockMd(block, markdown) {
  return {
    ...block,
    content: {
      ...block.content,
      markdown,
    },
  };
}

function shouldSkipMainDocListBlock(block) {
  // 主文档列表链路只认标题和文本正文，其他 block 一律跳过但不断链。
  return !isMainDocTextListBlock(block);
}

function createMainDocTextListOptions(anchorBlock) {
  return createTypedMarkdownListOptions({
    anchorItem: anchorBlock,
    getMarkdown: getBlockMd,
    setMarkdown: setBlockMd,
    getItemType: getMainDocTextListType,
    shouldSkipItem: shouldSkipMainDocListBlock,
  });
}

function renumberMainDocTextListAt(blocks, blockIdx) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return blocks;
  return renumberOrderedGroupAt(blocks, blockIdx, createMainDocTextListOptions(anchorBlock));
}

function renumberMainDocTextListFrom(blocks, blockIdx, startNum) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return blocks;
  const md = getBlockMd(anchorBlock);
  const parsed = parseListPrefix(md);
  if (!parsed) return blocks;
  const opts = createMainDocTextListOptions(anchorBlock);
  const result = renumberOrderedItemsFrom(blocks, blockIdx, parsed.indent, startNum, opts);
  return result ?? blocks;
}

function isOrderedMainDocTextListAt(blocks, blockIdx) {
  const anchorBlock = blocks[blockIdx];
  if (!anchorBlock || !isMainDocTextListBlock(anchorBlock)) return false;
  const parsed = parseListPrefix(getBlockMd(anchorBlock));
  return !!parsed && /^(\d+\.|[a-z]+\.)$/.test(parsed.marker);
}

function maybeRenumberMainDocTextListAt(blocks, blockIdx) {
  if (!isOrderedMainDocTextListAt(blocks, blockIdx)) return blocks;
  return renumberMainDocTextListAt(blocks, blockIdx);
}

function makeDefaultBlock(type) {
  const id = genId();
  switch (type) {
    case 'h1': return { id, type, content: { type: 'text', markdown: '新标题' } };
    case 'h2': return { id, type, content: { type: 'text', markdown: '新 H2 标题' } };
    case 'h3': return { id, type, content: { type: 'text', markdown: '新 H3 标题' } };
    case 'h4': return { id, type, content: { type: 'text', markdown: '新 H4 标题' } };
    case 'h5': return { id, type, content: { type: 'text', markdown: '新 H5 标题' } };
    case 'h6': return { id, type, content: { type: 'text', markdown: '新 H6 标题' } };
    case 'h7': return { id, type, content: { type: 'text', markdown: '新 H7 标题' } };
    case 'paragraph': return { id, type, content: { type: 'text', markdown: '' } };
    case 'divider': return { id, type, content: { type: 'divider' } };
    case 'mermaid': return { id, type, content: { type: 'mermaid', code: 'graph LR\n  A[开始] --> B[结束]' } };
    case 'mindmap': return { id, type, content: { type: 'mindmap', code: '- 主题\n  - 分支1\n  - 分支2' } };
    case 'table': return {
      id, type,
      content: {
        type: 'table',
        headers: ['列1', '列2', '列3'],
        rows: [makeEmptyRow(3)],
      },
    };
    default: return { id, type: 'paragraph', content: { type: 'text', markdown: '' } };
  }
}

function getCellScrollSignature(cell) {
  const elements = cell?.elements
    ?? (cell?.element ? [cell.element] : []);
  return elements.map((element) => {
    if (!element) return '';
    if (element.type === 'image') return `img:${element.src || ''}`;
    if (element.type === 'mermaid') return `mermaid:${element.code || ''}`;
    if (element.type === 'mindmap') return `mindmap:${element.code || ''}`;
    return `txt:${element.markdown || ''}`;
  }).join('<br>');
}

function getBlockScrollSignature(block) {
  if (!block) return '';
  if (/^h[1-7]$/.test(block.type)) {
    return `${block.type}:text:${block.content?.markdown || ''}`;
  }
  if (block.type === 'paragraph') {
    if (block.content?.type === 'image') return `paragraph:image:${block.content?.src || ''}`;
    return `paragraph:text:${block.content?.markdown || ''}`;
  }
  if (block.type === 'divider') return 'divider';
  if (block.type === 'mermaid') return `mermaid:${block.content?.code || ''}`;
  if (block.type === 'mindmap') return `mindmap:${block.content?.code || ''}`;
  if (block.type === 'table') {
    const headers = block.content?.headers?.join('|') || '';
    const firstRow = block.content?.rows?.[0]?.map(getCellScrollSignature).join('|') || '';
    return `table:${headers}::${firstRow}`;
  }
  return `${block.type}:${JSON.stringify(block.content ?? null)}`;
}

function getBlockIdentitySignature(block) {
  if (!block) return '';
  return `${block.type}:${JSON.stringify(block.content ?? null)}`;
}

function reconcileLoadedBlockIds(prevBlocks, nextBlocks) {
  if (!prevBlocks?.length || !nextBlocks?.length) return nextBlocks;
  const idBuckets = new Map();

  prevBlocks.forEach((block) => {
    const signature = getBlockIdentitySignature(block);
    const bucket = idBuckets.get(signature) || [];
    bucket.push(block.id);
    idBuckets.set(signature, bucket);
  });

  return nextBlocks.map((block) => {
    const signature = getBlockIdentitySignature(block);
    const bucket = idBuckets.get(signature);
    if (!bucket?.length) return block;
    const reusedId = bucket.shift();
    return reusedId ? { ...block, id: reusedId } : block;
  });
}

function captureViewportSnapshot(blocks, blockRefsMap, container) {
  if (!blocks?.length || !container) return null;
  const containerRect = container.getBoundingClientRect();
  let anchor = null;

  blocks.forEach((block, index) => {
    const node = blockRefsMap[block.id];
    if (!node) return;
    const rect = node.getBoundingClientRect();
    if (rect.bottom <= containerRect.top || rect.top >= containerRect.bottom) return;
    const candidate = {
      index,
      signature: getBlockScrollSignature(block),
      offsetTop: rect.top - containerRect.top,
      distance: Math.abs(rect.top - containerRect.top),
    };
    if (!anchor || candidate.distance < anchor.distance) {
      anchor = candidate;
    }
  });

  return {
    scrollTop: container.scrollTop,
    anchorIndex: anchor?.index ?? null,
    anchorSignature: anchor?.signature ?? '',
    anchorOffsetTop: anchor?.offsetTop ?? 0,
  };
}

function restoreViewportSnapshot(snapshot, blocks, blockRefsMap, container) {
  if (!snapshot || !blocks?.length || !container) return false;
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  const clampScrollTop = (top) => Math.max(0, Math.min(top, maxScrollTop));
  const fallbackScrollTop = clampScrollTop(snapshot.scrollTop ?? 0);

  let targetIndex = -1;
  if (snapshot.anchorSignature) {
    const matches = [];
    blocks.forEach((block, index) => {
      if (getBlockScrollSignature(block) === snapshot.anchorSignature) matches.push(index);
    });
    if (matches.length) {
      targetIndex = matches[0];
      for (const currentIdx of matches) {
        if (Math.abs(currentIdx - (snapshot.anchorIndex ?? 0)) < Math.abs(targetIndex - (snapshot.anchorIndex ?? 0))) {
          targetIndex = currentIdx;
        }
      }
    }
  }
  if (targetIndex < 0 && snapshot.anchorIndex != null && blocks[snapshot.anchorIndex]) {
    targetIndex = snapshot.anchorIndex;
  }
  if (targetIndex < 0) {
    container.scrollTop = fallbackScrollTop;
    return false;
  }

  const targetBlock = blocks[targetIndex];
  const node = blockRefsMap[targetBlock.id];
  if (!node) {
    container.scrollTop = fallbackScrollTop;
    return false;
  }

  const containerRect = container.getBoundingClientRect();
  const nodeRect = node.getBoundingClientRect();
  const desiredScrollTop = container.scrollTop + (nodeRect.top - containerRect.top) - (snapshot.anchorOffsetTop ?? 0);
  container.scrollTop = clampScrollTop(desiredScrollTop);
  return true;
}

function cloneBlockWithNewId(block) {
  return {
    ...cloneSerializable(block),
    id: genId(),
  };
}

function makePrdSectionTemplateBlocks() {
  const heading = { id: genId(), type: 'h2', content: { type: 'text', markdown: '新章节' } };
  const table = {
    id: genId(),
    type: 'table',
    content: {
      type: 'table',
      headers: [...PRD_SECTION_HEADERS],
      rows: [makeEmptyRow(PRD_SECTION_HEADERS.length)],
    },
  };
  return [heading, table];
}

// 兼容历史 prd-section：进入编辑态时转为普通 h2 + table
function normalizeLegacyBlocks(blocks) {
  const out = [];
  for (const block of blocks || []) {
    if (block.type === 'prd-section') {
      const { title, designImage, interactionMarkdown, logicMarkdown } = block.content || {};
      out.push({ id: genId(), type: 'h2', content: { type: 'text', markdown: title || '新章节' } });
      // 把舊的 prd-section 欄位轉為 CellElement
      const toCell = (v) => {
        if (!v) return makeEmptyCell();
        const imgMatch = v.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
        if (imgMatch) return { elements: [{ type: 'image', src: imgMatch[2] }] };
        return { elements: [{ type: 'text', markdown: v }] };
      };
      out.push({
        id: genId(),
        type: 'table',
        content: {
          type: 'table',
          headers: [...PRD_SECTION_HEADERS],
          rows: [[toCell(designImage), toCell(interactionMarkdown), toCell(logicMarkdown)]],
        },
      });
    } else if (block.type === 'link-list') {
      const { title, links } = block.content || {};
      const parts = [];
      if (title) parts.push(`## ${title}`);
      for (const { text, url } of links || []) {
        parts.push(`[${text}](${url})`);
      }
      out.push({
        id: block.id,
        type: 'paragraph',
        content: { type: 'text', markdown: parts.join('\n\n') },
      });
    } else {
      out.push(block);
    }
  }
  return out;
}

// ─── 刪除確認彈窗 ────────────────────────────────────────────────────────────

function DeleteConfirmModal({ block, onConfirm, onCancel }) {
  return (
    <div className="prd-modal-overlay" onClick={onCancel}>
      <div className="prd-modal" onClick={(e) => e.stopPropagation()}>
        <p className="prd-modal__text">
          确定删除这个「<strong>{BLOCK_TYPE_LABELS[block.type] || block.type}</strong>」块吗？
        </p>
        <div className="prd-modal__actions">
          <button className="prd-modal__btn prd-modal__btn--cancel" onClick={onCancel}>取消</button>
          <button className="prd-modal__btn prd-modal__btn--confirm" onClick={onConfirm}>删除</button>
        </div>
      </div>
    </div>
  );
}

function ExportPackageModal({
  value,
  error,
  exporting,
  inputRef,
  onChange,
  onCancel,
  onConfirm,
}) {
  return (
    <div className="prd-modal-overlay" onClick={onCancel}>
      <div className="prd-modal prd-modal--form" onClick={(e) => e.stopPropagation()}>
        <div className="prd-modal__header">
          <div className="prd-modal__title">重命名离线包</div>
          <div className="prd-modal__desc">仅影响下载的 ZIP 文件名，不会修改压缩包内部文件名。</div>
        </div>
        <div className="prd-modal__field">
          <label className="prd-modal__label" htmlFor="prd-export-package-name">离线包名称</label>
          <input
            id="prd-export-package-name"
            ref={inputRef}
            className="prd-modal__input"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                onConfirm();
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                onCancel();
              }
            }}
            disabled={exporting}
            placeholder="请输入离线包名称"
          />
          <div className="prd-modal__hint">{PRD_FILE_NAME_RULE_HINT}</div>
          {error ? <div className="prd-modal__error">{error}</div> : null}
        </div>
        <div className="prd-modal__actions">
          <button className="prd-modal__btn prd-modal__btn--cancel" onClick={onCancel} disabled={exporting}>取消</button>
          <button className="prd-modal__btn prd-modal__btn--primary" onClick={onConfirm} disabled={exporting || !value.trim()}>
            {exporting ? '导出中…' : '确认导出'}
          </button>
        </div>
      </div>
    </div>
  );
}

function ToastIcon({ tone }) {
  if (tone === 'error') return <FiAlertCircle className="prd-toast__icon" />;
  if (tone === 'warning') return <FiAlertTriangle className="prd-toast__icon" />;
  return <FiCheckCircle className="prd-toast__icon" />;
}

function ToastViewport({ toasts }) {
  if (!toasts.length) return null;
  return createPortal(
    <div className="prd-toast-viewport" aria-live="polite" aria-atomic="true">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={[
            'prd-toast',
            `prd-toast--${toast.tone}`,
            toast.visible ? 'prd-toast--visible' : 'prd-toast--hidden',
          ].filter(Boolean).join(' ')}
        >
          <ToastIcon tone={toast.tone} />
          <span className="prd-toast__text">{toast.message}</span>
        </div>
      ))}
    </div>,
    document.body,
  );
}

const OutlineSidebar = memo(function OutlineSidebar({
  open, items, activeId, onToggle, onItemClick, onInteract,
}) {
  const scrollRef = useRef(null);
  const itemRefs = useRef({});

  useEffect(() => {
    if (!open || !activeId) return;
    const container = scrollRef.current;
    const node = itemRefs.current[activeId];
    if (!container || !node) return;

    const containerRect = container.getBoundingClientRect();
    const nodeRect = node.getBoundingClientRect();
    const margin = 12;

    if (nodeRect.top < containerRect.top + margin) {
      container.scrollTo({
        top: container.scrollTop - ((containerRect.top + margin) - nodeRect.top),
        behavior: 'smooth',
      });
      return;
    }

    if (nodeRect.bottom > containerRect.bottom - margin) {
      container.scrollTo({
        top: container.scrollTop + (nodeRect.bottom - (containerRect.bottom - margin)),
        behavior: 'smooth',
      });
    }
  }, [activeId, open, items]);

  return (
    <>
      {!open && (
        <button
          type="button"
          className="prd-page__toc-toggle"
          onMouseDown={onInteract}
          onClick={onToggle}
          title="展开目录"
          aria-label="展开目录"
        >
          <FiMenu aria-hidden="true" />
        </button>
      )}
      <aside
        className={[
          'prd-page__toc-pane',
          open ? 'prd-page__toc-pane--open' : '',
        ].filter(Boolean).join(' ')}
        aria-hidden={!open}
        onMouseDown={onInteract}
      >
        <div className="prd-page__toc-shell">
          <div className="prd-page__toc-header">
            <button
              type="button"
              className="prd-page__toc-toggle prd-page__toc-toggle--inline"
              onMouseDown={onInteract}
              onClick={onToggle}
              title="收起目录"
              aria-label="收起目录"
            >
              <FiChevronsLeft aria-hidden="true" />
            </button>
            <span className="prd-page__toc-title">目录</span>
          </div>
          <div className="prd-page__toc-scroll" ref={scrollRef}>
            <div className="prd-page__toc-tree">
              {items.length ? items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  ref={(node) => {
                    if (node) itemRefs.current[item.id] = node;
                    else delete itemRefs.current[item.id];
                  }}
                  className={[
                    'prd-page__toc-item',
                    `prd-page__toc-item--level-${item.level}`,
                    activeId === item.id ? 'prd-page__toc-item--active' : '',
                  ].filter(Boolean).join(' ')}
                  onClick={() => onItemClick(item.id)}
                  title={item.title}
                >
                  <span className="prd-page__toc-item-text">{item.title}</span>
                </button>
              )) : (
                <div className="prd-page__toc-empty">暂无目录</div>
              )}
            </div>
          </div>
        </div>
      </aside>
    </>
  );
});

// ─── BlockItem（單個 Block 容器，下方浮层 actionbar）────────────────────────

const BlockItem = memo(function BlockItem({
  block, onUpdate, onDelete, onDuplicate, onInsertBefore, onInsertAfter,
  onMoveUp, onMoveDown, canMoveUp, canMoveDown,
  activeActionBlockId, requestActionbarOpen, requestActionbarClose, keepActionbarOpen, clearActionbarState,
  activeInsertMenuOwnerId, openInsertMenu, closeInsertMenu,
  globalSelection, setGlobalSelection,
  shouldFocus, onFocusConsumed,
  onEnterBlock, onBackspaceEmptyBlock, onPasteImageAsBlockBlock,
  imageMeta, onImageWidthChange,
  setFocusBlockId, registerBlockRef, onEditingFinishedBlock,
  rowBindings,
  annotationsDoc,
  onAnnotateUsage,
  onSetCellChangeIntent,
  onSetCellPendingConfirm,
  onSetCellPendingConfirmNote,
  onCellEdited,
  onResetOrderedStartBlock,
  mermaidMeta, onMermaidMetaChange,
  mindmapMeta, onMindmapMetaChange,
}) {
  const [showInsertMenu, setShowInsertMenu] = useState(null); // 'above' | 'below' | null
  const suppressActionbarUntilLeaveRef = useRef(false);
  const rootRef = useRef(null);
  const hasGlobalSelection = globalSelection != null;
  const insertMenuOwnerId = block.id;

  useEffect(() => {
    if (activeInsertMenuOwnerId === insertMenuOwnerId) return;
    setShowInsertMenu(null);
  }, [activeInsertMenuOwnerId, insertMenuOwnerId]);

  const openActionbar = () => {
    if (hasGlobalSelection) return;
    if (suppressActionbarUntilLeaveRef.current) return;
    requestActionbarOpen(block.id);
  };

  const closeActionbarWithDelay = () => {
    requestActionbarClose(block.id);
    setShowInsertMenu(null);
    closeInsertMenu(insertMenuOwnerId);
  };

  const closeActionbarImmediately = useCallback(() => {
    requestActionbarClose(block.id, { immediate: true });
    setShowInsertMenu(null);
    closeInsertMenu(insertMenuOwnerId);
  }, [block.id, closeInsertMenu, insertMenuOwnerId, requestActionbarClose]);

  const handleEnter = useCallback((md) => {
    onEnterBlock(block.id, md, block.type);
  }, [onEnterBlock, block.id, block.type]);

  const handleBackspaceEmpty = useCallback(() => {
    onBackspaceEmptyBlock(block.id);
  }, [onBackspaceEmptyBlock, block.id]);

  const handlePasteImageAsBlock = useCallback((src) => {
    onPasteImageAsBlockBlock(block.id, src);
  }, [onPasteImageAsBlockBlock, block.id]);

  const handleEditingFinished = useCallback(() => {
    onEditingFinishedBlock?.(block.id);
  }, [onEditingFinishedBlock, block.id]);

  // shouldFocus：Enter 新增後需要聚焦此 block
  const contentRef = useRef(null);
  useEffect(() => {
    if (!shouldFocus) return;
    suppressActionbarUntilLeaveRef.current = true;
    clearActionbarState();
    // 找到第一個可聚焦的輸入元素
    const el = contentRef.current?.querySelector(
      'input, textarea, [contenteditable], .prd-editable--view, .prd-editable-md--preview, .prd-image-renderer'
    );
    if (el) {
      el.click?.();
      el.focus?.();
    }
    onFocusConsumed?.();
  }, [shouldFocus, onFocusConsumed, clearActionbarState]);

  useEffect(() => {
    if (activeActionBlockId !== block.id || hasGlobalSelection || suppressActionbarUntilLeaveRef.current) return undefined;
    const handlePointerOutside = (event) => {
      if (nodeContainsTarget(rootRef.current, event.target)) return;
      closeActionbarImmediately();
    };
    const handleWindowMouseOut = (event) => {
      if (event.relatedTarget == null) closeActionbarImmediately();
    };
    document.addEventListener('mousemove', handlePointerOutside, true);
    document.addEventListener('mousedown', handlePointerOutside, true);
    window.addEventListener('blur', closeActionbarImmediately);
    window.addEventListener('mouseout', handleWindowMouseOut);
    return () => {
      document.removeEventListener('mousemove', handlePointerOutside, true);
      document.removeEventListener('mousedown', handlePointerOutside, true);
      window.removeEventListener('blur', closeActionbarImmediately);
      window.removeEventListener('mouseout', handleWindowMouseOut);
    };
  }, [activeActionBlockId, block.id, closeActionbarImmediately, hasGlobalSelection]);

  const renderContent = () => {
    switch (block.type) {
      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4':
      case 'h5':
      case 'h6':
      case 'h7':
        return (
          <HeadingBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={handleEnter}
            onBackspaceEmpty={handleBackspaceEmpty}
            setFocusBlockId={setFocusBlockId}
            onEditingFinished={handleEditingFinished}
          />
        );
      case 'paragraph':
        return (
          <ParagraphBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            onEnter={handleEnter}
            onBackspaceEmpty={handleBackspaceEmpty}
            onPasteImageAsBlock={handlePasteImageAsBlock}
            imageMeta={imageMeta}
            onImageWidthChange={onImageWidthChange}
            setFocusBlockId={setFocusBlockId}
            onEditingFinished={handleEditingFinished}
            onMoveUp={() => onMoveUp(block.id)}
            onMoveDown={() => onMoveDown(block.id)}
            canMoveUp={canMoveUp}
            canMoveDown={canMoveDown}
            onResetOrderedStart={onResetOrderedStartBlock ? (newMd, startNum) => onResetOrderedStartBlock(block.id, newMd, startNum) : undefined}
          />
        );
      case 'divider':
        return <DividerBlock />;
      case 'mermaid':
        return (
          <MermaidBlock
            block={block}
            onUpdate={onUpdate}
            mermaidMeta={mermaidMeta}
            onMermaidMetaChange={onMermaidMetaChange}
          />
        );
      case 'mindmap':
        return (
          <MindmapBlock
            block={block}
            onUpdate={onUpdate}
            mindmapMeta={mindmapMeta}
            onMindmapMetaChange={onMindmapMetaChange}
          />
        );
      case 'table':
        return (
          <TableBlock
            block={block}
            onUpdate={onUpdate}
            globalSelection={globalSelection}
            setGlobalSelection={setGlobalSelection}
            setActiveActionBlockId={clearActionbarState}
            rowBindings={rowBindings}
            annotationsDoc={annotationsDoc}
            onAnnotateUsage={onAnnotateUsage}
            onSetCellChangeIntent={onSetCellChangeIntent}
            onSetCellPendingConfirm={onSetCellPendingConfirm}
            onSetCellPendingConfirmNote={onSetCellPendingConfirmNote}
            onCellEdited={onCellEdited}
            hoverSuppressed={activeInsertMenuOwnerId != null}
            mermaidMeta={mermaidMeta}
            onMermaidMetaChange={onMermaidMetaChange}
            mindmapMeta={mindmapMeta}
            onMindmapMetaChange={onMindmapMetaChange}
          />
        );
      default:
        return <div className="prd-block-unknown">未知 Block 类型：{block.type}</div>;
    }
  };

  return (
    <div
      ref={(node) => {
        rootRef.current = node;
        registerBlockRef?.(block.id, node);
      }}
      className={[
        'prd-block-item',
        (activeActionBlockId === block.id || showInsertMenu != null) ? 'prd-block-item--action-active' : '',
      ].filter(Boolean).join(' ')}
      onMouseEnter={openActionbar}
      onMouseLeave={() => {
        suppressActionbarUntilLeaveRef.current = false;
        closeActionbarWithDelay();
      }}
    >
      {/* Block 内容 */}
      <div className="prd-block-content" ref={contentRef}>
        {renderContent()}
      </div>

      {/* 下方浮层 actionbar（hover 时显示） */}
      <ActionPanel
        visible={
          activeActionBlockId === block.id
          && !hasGlobalSelection
          && !suppressActionbarUntilLeaveRef.current
          && !(globalSelection && globalSelection.blockId === block.id)
        }
        className="prd-block-actionbar"
        onMouseEnter={() => {
          keepActionbarOpen(block.id);
        }}
        onMouseLeave={closeActionbarWithDelay}
      >
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => onDuplicate(block.id)}
        >
          复制
        </button>
        <button
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => {
            const next = showInsertMenu === 'above' ? null : 'above';
            setShowInsertMenu(next);
            if (next) openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
            else closeInsertMenu(insertMenuOwnerId);
          }}
        >
          上方插入
        </button>
        <button
          className="prd-action-btn prd-block-actionbar__btn"
          onClick={() => {
            const next = showInsertMenu === 'below' ? null : 'below';
            setShowInsertMenu(next);
            if (next) openInsertMenu(insertMenuOwnerId, { preserveActionbarBlockId: block.id });
            else closeInsertMenu(insertMenuOwnerId);
          }}
        >
          下方插入
        </button>
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          disabled={!canMoveUp}
          title="上移"
          onClick={() => onMoveUp(block.id)}
        >
          上移
        </button>
        <button
          type="button"
          className="prd-action-btn prd-block-actionbar__btn"
          disabled={!canMoveDown}
          title="下移"
          onClick={() => onMoveDown(block.id)}
        >
          下移
        </button>
        <button
          className="prd-action-btn prd-action-btn--danger prd-block-actionbar__btn prd-block-actionbar__btn--delete"
          onClick={() => onDelete(block.id)}
        >
          删除
        </button>

        {/* 上方插入菜单 */}
        {showInsertMenu === 'above' && (
          <AddBlockMenu
            onAdd={(type) => { onInsertBefore(block.id, type); setShowInsertMenu(null); }}
            onClose={() => {
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
            position="above"
          />
        )}

        {/* 下方插入菜单 */}
        {showInsertMenu === 'below' && (
          <AddBlockMenu
            onAdd={(type) => { onInsertAfter(block.id, type); setShowInsertMenu(null); }}
            onClose={() => {
              setShowInsertMenu(null);
              closeInsertMenu(insertMenuOwnerId);
            }}
            position="below"
          />
        )}
      </ActionPanel>
    </div>
  );
}, function areBlockItemPropsEqual(prev, next) {
  // 只有自己的激活状态相关 prop 变化时才重渲，避免全列表因 hover 级联更新
  if (prev.block !== next.block) return false;
  if (prev.canMoveUp !== next.canMoveUp || prev.canMoveDown !== next.canMoveDown) return false;
  if (prev.shouldFocus !== next.shouldFocus) return false;
  if (prev.selectionKey !== next.selectionKey) return false;
  if (prev.rowBindingsKey !== next.rowBindingsKey) return false;
  if (prev.imageMetaKey !== next.imageMetaKey) return false;
  if (prev.annotationsKey !== next.annotationsKey) return false;
  if (prev.mermaidMetaKey !== next.mermaidMetaKey) return false;
  if (prev.mindmapMetaKey !== next.mindmapMetaKey) return false;
  // activeActionBlockId：只在"是否影响本 block"的结果变化时才重渲
  const prevActive = prev.activeActionBlockId === prev.block.id;
  const nextActive = next.activeActionBlockId === next.block.id;
  if (prevActive !== nextActive) return false;
  // activeInsertMenuOwnerId：同理
  const prevMenu = prev.activeInsertMenuOwnerId === prev.block.id;
  const nextMenu = next.activeInsertMenuOwnerId === next.block.id;
  if (prevMenu !== nextMenu) return false;
  // 回调函数用 useCallback 保证引用稳定，不需要逐一比较
  return true;
});

const BlockCanvas = memo(function BlockCanvas({
  blocks,
  blockUiState,
  selectionState,
  sidecarState,
  annotationState,
  rowBindingsByBlock,
  blockPerfKeysById,
  callbacks,
}) {
  return (
    <main className="prd-page__main">
      {blocks.map((block, index) => {
        const perfKeys = blockPerfKeysById.get(block.id) || EMPTY_BLOCK_PERF_KEYS;
        return (
          <BlockItem
            key={block.id}
            block={block}
            onUpdate={callbacks.onUpdate}
            onDelete={callbacks.onDelete}
            onDuplicate={callbacks.onDuplicate}
            onInsertBefore={callbacks.onInsertBefore}
            onInsertAfter={callbacks.onInsertAfter}
            onMoveUp={callbacks.onMoveUp}
            onMoveDown={callbacks.onMoveDown}
            canMoveUp={index > 0}
            canMoveDown={index < blocks.length - 1}
            activeActionBlockId={blockUiState.activeActionBlockId}
            requestActionbarOpen={blockUiState.requestActionbarOpen}
            requestActionbarClose={blockUiState.requestActionbarClose}
            keepActionbarOpen={blockUiState.keepActionbarOpen}
            clearActionbarState={blockUiState.clearActionbarState}
            activeInsertMenuOwnerId={blockUiState.activeInsertMenuOwnerId}
            openInsertMenu={blockUiState.openInsertMenu}
            closeInsertMenu={blockUiState.closeInsertMenu}
            selectionKey={perfKeys.selectionKey}
            rowBindingsKey={perfKeys.rowBindingsKey}
            imageMetaKey={perfKeys.imageMetaKey}
            annotationsKey={perfKeys.annotationsKey}
            mermaidMetaKey={perfKeys.mermaidMetaKey}
            mindmapMetaKey={perfKeys.mindmapMetaKey}
            globalSelection={selectionState.globalSelection}
            setGlobalSelection={selectionState.setGlobalSelection}
            shouldFocus={blockUiState.focusBlockId === block.id}
            onFocusConsumed={blockUiState.clearFocusBlockId}
            onEnterBlock={callbacks.onEnterBlock}
            onBackspaceEmptyBlock={callbacks.onBackspaceEmptyBlock}
            onPasteImageAsBlockBlock={callbacks.onPasteImageAsBlockBlock}
            imageMeta={sidecarState.imageMeta}
            onImageWidthChange={sidecarState.onImageWidthChange}
            setFocusBlockId={blockUiState.setFocusBlockId}
            registerBlockRef={blockUiState.registerBlockRef}
            onEditingFinishedBlock={blockUiState.onEditingFinishedBlock}
            rowBindings={rowBindingsByBlock.get(block.id) || EMPTY_ROW_BINDINGS}
            annotationsDoc={annotationState.annotationsDoc}
            onAnnotateUsage={annotationState.onAnnotateUsage}
            onSetCellChangeIntent={annotationState.onSetCellChangeIntent}
            onSetCellPendingConfirm={annotationState.onSetCellPendingConfirm}
            onSetCellPendingConfirmNote={annotationState.onSetCellPendingConfirmNote}
            onCellEdited={annotationState.onCellEdited}
            onResetOrderedStartBlock={annotationState.onResetOrderedStartBlock}
            mermaidMeta={sidecarState.mermaidMeta}
            onMermaidMetaChange={sidecarState.onMermaidMetaChange}
            mindmapMeta={sidecarState.mindmapMeta}
            onMindmapMetaChange={sidecarState.onMindmapMetaChange}
          />
        );
      })}

      <AddAtEndButton
        onAdd={callbacks.onAddAtEnd}
        activeInsertMenuOwnerId={blockUiState.activeInsertMenuOwnerId}
        openInsertMenu={blockUiState.openInsertMenu}
        closeInsertMenu={blockUiState.closeInsertMenu}
      />
    </main>
  );
});

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

// ─── 頁面末尾新增按鈕 ────────────────────────────────────────────────────────

function AddAtEndButton({ onAdd, activeInsertMenuOwnerId, openInsertMenu, closeInsertMenu }) {
  const [showMenu, setShowMenu] = useState(false);
  const ownerId = 'add-at-end';

  useEffect(() => {
    if (activeInsertMenuOwnerId === ownerId) return;
    setShowMenu(false);
  }, [activeInsertMenuOwnerId]);

  return (
    <div className="prd-add-end">
      <button
        className="prd-add-section-btn"
        onClick={() => {
          const next = !showMenu;
          setShowMenu(next);
          if (next) openInsertMenu(ownerId);
          else closeInsertMenu(ownerId);
        }}
      >
        + 新增块
      </button>
      {showMenu && (
        <AddBlockMenu
          position="above"
          onAdd={onAdd}
          onClose={() => {
            setShowMenu(false);
            closeInsertMenu(ownerId);
          }}
        />
      )}
    </div>
  );
}

// ─── PRD 顶部工具栏 ──────────────────────────────────────────────────────────

function PrdToolbar({
  activeSlug, blocks, onSwitch, onExport, exporting = false,
}) {
  const [switchPanelOpen, setSwitchPanelOpen] = useState(false);
  const [docs, setDocs] = useState([]);
  const [docsLoading, setDocsLoading] = useState(false);
  // 当前文档标题（独立维护，让 topbar selector 在面板未打开时也能显示）
  const [activeTitle, setActiveTitle] = useState('');

  // 新建文档状态
  const [creating, setCreating] = useState(false);
  const [newDocName, setNewDocName] = useState('');
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');
  const newDocComposingRef = useRef(false);

  // 重命名状态：{ slug, value, error, loading }
  const [renaming, setRenaming] = useState(null);
  const renameComposingRef = useRef(false);

  // 导出离线包命名
  const [exportDialogOpen, setExportDialogOpen] = useState(false);
  const [exportPackageName, setExportPackageName] = useState('');
  const [exportPackageError, setExportPackageError] = useState('');

  // 切换中
  const [switchingSlug, setSwitchingSlug] = useState(null);

  const switchBtnRef = useRef(null);
  const panelRef = useRef(null);
  const newDocInputRef = useRef(null);
  const renameInputRef = useRef(null);
  const exportInputRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState({});

  function closePanel() {
    setSwitchPanelOpen(false);
    setCreating(false);
    setNewDocName('');
    setCreateError('');
    setRenaming(null);
  }

  function getDefaultExportPackageName() {
    return normalizeProjectLikeName(activeTitle || activeSlug || '') || activeSlug || 'prd-export';
  }

  function openExportDialog() {
    setExportPackageName(getDefaultExportPackageName());
    setExportPackageError('');
    setExportDialogOpen(true);
  }

  function closeExportDialog() {
    if (exporting) return;
    setExportDialogOpen(false);
    setExportPackageError('');
  }

  // 挂载时立即拉一次列表（用于 topbar 显示当前文档名）
  useEffect(() => {
    fetchDocList().then(list => {
      setDocs(list);
      const cur = list.find(d => d.slug === activeSlug);
      if (cur) setActiveTitle(cur.title);
    });
  }, []);

  // activeSlug 变化时同步更新 activeTitle
  useEffect(() => {
    const cur = docs.find(d => d.slug === activeSlug);
    if (cur) setActiveTitle(cur.title);
  }, [activeSlug, docs]);

  // 打开面板时计算 fixed 定位坐标（相对于触发按钮）
  useEffect(() => {
    if (!switchPanelOpen || !switchBtnRef.current) return;
    const rect = switchBtnRef.current.getBoundingClientRect();
    setPanelStyle({
      top: rect.bottom + 6,
      right: window.innerWidth - rect.right,
    });
  }, [switchPanelOpen]);

  // 打开面板时刷新列表：有缓存则立即展示（不 loading），后台静默更新
  useEffect(() => {
    if (!switchPanelOpen) return;
    const hasCached = docs.length > 0;
    if (!hasCached) setDocsLoading(true);
    fetchDocList()
      .then(list => {
        setDocs(list);
        const cur = list.find(d => d.slug === activeSlug);
        if (cur) setActiveTitle(cur.title);
      })
      .finally(() => setDocsLoading(false));
  }, [switchPanelOpen]);

  // 新建输入框出现时自动聚焦
  useEffect(() => {
    if (creating) setTimeout(() => newDocInputRef.current?.focus(), 30);
  }, [creating]);

  // 重命名输入框出现时自动聚焦并全选
  useEffect(() => {
    if (renaming) setTimeout(() => { renameInputRef.current?.focus(); renameInputRef.current?.select(); }, 30);
  }, [renaming?.slug]);

  useEffect(() => {
    if (exportDialogOpen) {
      setTimeout(() => {
        exportInputRef.current?.focus();
        exportInputRef.current?.select();
      }, 30);
    }
  }, [exportDialogOpen]);

  // 点击面板外部关闭
  useEffect(() => {
    if (!switchPanelOpen) return;
    function handleClickOutside(e) {
      if (
        panelRef.current && !panelRef.current.contains(e.target) &&
        switchBtnRef.current && !switchBtnRef.current.contains(e.target)
      ) closePanel();
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [switchPanelOpen]);

  async function handleSwitchDoc(slug) {
    if (slug === activeSlug || switchingSlug || renaming) return;
    setSwitchingSlug(slug);
    try {
      await switchDoc(slug);
      onSwitch?.(slug);
      setSwitchPanelOpen(false);
    } finally {
      setSwitchingSlug(null);
    }
  }

  async function handleCreateDoc() {
    const name = normalizeProjectLikeName(newDocName);
    if (!name) { setCreateError('请输入合法文件名'); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      const result = await createDoc(name);
      if (!result.ok) {
        setCreateError(
          result.error === 'slug already exists'
            ? '同名文档已存在，请换个名称'
            : (mapPrdFileNameError(result.error) || '创建失败'),
        );
        return;
      }
      setCreating(false);
      setNewDocName('');
      onSwitch?.(result.slug);
      setSwitchPanelOpen(false);
    } catch (e) {
      setCreateError(e.message || '创建失败');
    } finally {
      setCreateLoading(false);
    }
  }

  function startRename(doc, e) {
    e.stopPropagation();
    setRenaming({ slug: doc.slug, value: doc.title, error: '', loading: false });
    setCreating(false);
  }

  async function handleRenameDoc() {
    if (!renaming || renaming.loading) return;
    const name = normalizeProjectLikeName(renaming.value);
    if (!name) { setRenaming(r => ({ ...r, error: '请输入合法文件名' })); return; }
    if (name === docs.find(d => d.slug === renaming.slug)?.title) { setRenaming(null); return; }
    setRenaming(r => ({ ...r, loading: true, error: '' }));
    try {
      const result = await renameDoc(renaming.slug, name);
      if (!result.ok) {
        setRenaming(r => ({
          ...r,
          loading: false,
          error: result.error === 'filename already exists' ? '同名文件已存在' : (mapPrdFileNameError(result.error) || '重命名失败'),
        }));
        return;
      }
      setDocs(list => list.map(d => d.slug === renaming.slug ? { ...d, title: result.title } : d));
      if (renaming.slug === activeSlug) setActiveTitle(result.title);
      setRenaming(null);
    } catch (e) {
      setRenaming(r => ({ ...r, loading: false, error: e.message || '重命名失败' }));
    }
  }

  async function handleExportWithPackageName() {
    const archiveName = normalizeProjectLikeName(exportPackageName);
    if (!archiveName) {
      setExportPackageError('请输入合法文件名');
      return;
    }
    setExportPackageError('');
    await onExport?.({
      currentTitle: activeTitle || activeSlug,
      archiveName,
    });
    setExportDialogOpen(false);
  }

  return (
    <div className="prd-toolbar">
      {/* ── 左侧：占位，保持工具栏撑满 ── */}
      <div className="prd-toolbar__left" />

      {/* ── 右侧：文档选择器 + 导出 + 飞书 ── */}
      <div className="prd-toolbar__right">
        <div className="prd-toolbar__switch-wrap prd-toolbar__switch-wrap--right">
          {/* 触发器：直接展示当前文档名 */}
          <button
            ref={switchBtnRef}
            className={`prd-toolbar__doc-selector${switchPanelOpen ? ' prd-toolbar__doc-selector--open' : ''}`}
            onClick={() => {
              if (switchPanelOpen) closePanel();
              else setSwitchPanelOpen(true);
            }}
          >
            <FiLayers className="prd-toolbar__doc-selector-icon" />
            <span className="prd-toolbar__doc-selector-name">
              {activeTitle || activeSlug || '加载中…'}
            </span>
            <FiChevronDown className={`prd-toolbar__doc-selector-caret${switchPanelOpen ? ' prd-toolbar__doc-selector-caret--open' : ''}`} />
          </button>

          {switchPanelOpen && (
            <div ref={panelRef} className="prd-toolbar__switch-panel" style={panelStyle} data-panel-open="true">
              <div className="prd-toolbar__switch-panel-list prd-toolbar__switch-panel-list--top-pad">
                {docsLoading ? (
                  <div className="prd-toolbar__switch-loading">加载中…</div>
                ) : docs.length === 0 ? (
                  <div className="prd-toolbar__switch-empty">暂无文档</div>
                ) : docs.map(doc => (
                  <div
                    key={doc.slug}
                    className={`prd-toolbar__switch-row${doc.slug === activeSlug ? ' prd-toolbar__switch-row--active' : ''}`}
                  >
                    {renaming?.slug === doc.slug ? (
                      /* ── 重命名内联编辑 ── */
                      <div className="prd-toolbar__rename-wrap">
                        <input
                          ref={renameInputRef}
                          className="prd-toolbar__rename-input"
                          value={renaming.value}
                          onChange={e => {
                            const v = renameComposingRef.current
                              ? e.target.value
                              : normalizeProjectLikeName(e.target.value);
                            setRenaming(r => ({ ...r, value: v, error: '' }));
                          }}
                          onCompositionStart={() => { renameComposingRef.current = true; }}
                          onCompositionEnd={e => {
                            renameComposingRef.current = false;
                            setRenaming(r => ({ ...r, value: normalizeProjectLikeName(e.target.value), error: '' }));
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter') { e.preventDefault(); handleRenameDoc(); }
                            if (e.key === 'Escape') setRenaming(null);
                          }}
                          disabled={renaming.loading}
                        />
                        <div className="prd-toolbar__rename-hint">{PRD_FILE_NAME_RULE_HINT}</div>
                        {renaming.error && <div className="prd-toolbar__rename-error">{renaming.error}</div>}
                        <div className="prd-toolbar__rename-actions">
                          <button
                            className="prd-toolbar__switch-create-cancel"
                            onClick={() => setRenaming(null)}
                            disabled={renaming.loading}
                          >取消</button>
                          <button
                            className="prd-toolbar__switch-create-confirm"
                            onClick={handleRenameDoc}
                            disabled={renaming.loading || !renaming.value.trim()}
                          >{renaming.loading ? '保存中…' : '保存'}</button>
                        </div>
                      </div>
                    ) : (
                      /* ── 正常行 ── */
                      <div className="prd-toolbar__switch-item">
                        <button
                          type="button"
                          className="prd-toolbar__switch-item-main"
                          onClick={() => handleSwitchDoc(doc.slug)}
                          disabled={!!switchingSlug}
                        >
                          {doc.slug === activeSlug
                            ? <FiCheck className="prd-toolbar__switch-item-check" />
                            : <span className="prd-toolbar__switch-item-check-placeholder" />
                          }
                          <span className="prd-toolbar__switch-item-name" title={doc.title}>{doc.title}</span>
                          {doc.slug === activeSlug && <span className="prd-toolbar__switch-item-badge">当前</span>}
                          {switchingSlug === doc.slug && <span className="prd-toolbar__switch-item-loading" />}
                        </button>
                        <button
                          type="button"
                          className="prd-toolbar__switch-item-rename"
                          title="重命名"
                          onClick={e => startRename(doc, e)}
                        >
                          <FiEdit2 />
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              <div className="prd-toolbar__switch-panel-footer">
                {!creating ? (
                  <button className="prd-toolbar__switch-new-btn" onClick={() => { setCreating(true); setRenaming(null); }}>
                    <FiPlus />
                    <span>新建 PRD</span>
                  </button>
                ) : (
                  <div className="prd-toolbar__switch-create">
                    <input
                      ref={newDocInputRef}
                      className="prd-toolbar__switch-create-input"
                      placeholder="输入英文文件名…"
                      value={newDocName}
                      onChange={e => {
                        const v = newDocComposingRef.current
                          ? e.target.value
                          : normalizeProjectLikeName(e.target.value);
                        setNewDocName(v);
                        setCreateError('');
                      }}
                      onCompositionStart={() => { newDocComposingRef.current = true; }}
                      onCompositionEnd={e => {
                        newDocComposingRef.current = false;
                        setNewDocName(normalizeProjectLikeName(e.target.value));
                        setCreateError('');
                      }}
                      onKeyDown={e => {
                        if (e.key === 'Enter') handleCreateDoc();
                        if (e.key === 'Escape') { setCreating(false); setNewDocName(''); setCreateError(''); }
                      }}
                      disabled={createLoading}
                    />
                    <div className="prd-toolbar__switch-create-hint">{PRD_FILE_NAME_RULE_HINT}</div>
                    {createError && <div className="prd-toolbar__switch-create-error">{createError}</div>}
                    <div className="prd-toolbar__switch-create-actions">
                      <button
                        className="prd-toolbar__switch-create-cancel"
                        onClick={() => { setCreating(false); setNewDocName(''); setCreateError(''); }}
                        disabled={createLoading}
                      >取消</button>
                      <button
                        className="prd-toolbar__switch-create-confirm"
                        onClick={handleCreateDoc}
                        disabled={createLoading || !newDocName.trim()}
                      >{createLoading ? '创建中…' : '创建'}</button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="prd-toolbar__divider" />
        <FeishuSyncEntry
          blocks={blocks}
          activeSlug={activeSlug}
          activeTitle={activeTitle}
        />
        <div className="prd-toolbar__divider" />
        <button
          className={`prd-toolbar__btn${exporting ? ' prd-toolbar__btn--active' : ''}`}
          title="导出可离线预览且包含源码的 ZIP 包"
          onClick={openExportDialog}
          disabled={exporting}
        >
          <FiDownload className="prd-toolbar__btn-icon" />
          <span>{exporting ? '导出中…' : '导出离线包'}</span>
        </button>
      </div>
      {exportDialogOpen ? (
        <ExportPackageModal
          value={exportPackageName}
          error={exportPackageError}
          exporting={exporting}
          inputRef={exportInputRef}
          onChange={(value) => {
            setExportPackageName(normalizeProjectLikeName(value));
            setExportPackageError('');
          }}
          onCancel={closeExportDialog}
          onConfirm={handleExportWithPackageName}
        />
      ) : null}
    </div>
  );
}
