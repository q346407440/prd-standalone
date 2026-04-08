export const SAVE_API = '/__prd__/save-md';
export const DELETE_IMAGE_API = '/__prd__/delete-image';
export const META_API = '/__prd__/meta';
export const SAVE_META_API = '/__prd__/save-meta';
export const ANNOTATIONS_API = '/__prd__/annotations';
export const SAVE_ANNOTATIONS_API = '/__prd__/save-annotations';
export const SAVE_ANNOTATION_ASSET_API = '/__prd__/save-annotation-asset';
export const DELETE_ANNOTATION_ASSET_API = '/__prd__/delete-annotation-asset';
export const PRD_EVENTS_API = '/__prd__/events';

/**
 * 僅控制「圖片上框選區域」標註：入口按鈕、標註彈窗，以及為其服務的效能（如各圖 region 數量掃描）。
 * 仍保留：`.annotations.json` 的圖片 usage／元資料、列與儲存格的變更意圖／待確認、reconcile、載入與儲存。
 * 需要框選標註時改回 true。
 */
export const ENABLE_IMAGE_ANNOTATION_UI = false;

/**
 * 表格「交互 / 逻辑」列上的「待确认」「仅参考」控件与单元格高亮样式。
 * 为 false 时不挂载相关组件（含每格 useViewportFit / 弹层监听），不读取 getCellState；PrdPage 不向子树传入写入回调（与 ENABLE_IMAGE_ANNOTATION_UI 一致）；perf key 不读 cellStates、不序列化 changeIntent / pendingConfirm。
 * `.annotations.json` 仍照常加载与保存；需要时再改为 true。
 */
export const ENABLE_TABLE_CELL_ANNOTATION_UI = false;

export const ACTIVE_DOC_API = '/__prd__/active-doc';
export const LIST_DOCS_API = '/__prd__/list-docs';
export const CREATE_DOC_API = '/__prd__/create-doc';
export const SWITCH_DOC_API = '/__prd__/switch-doc';
export const TOC_OPEN_STORAGE_KEY = 'prd-editor:toc-open';

export const DEFAULT_PRD_SLUG = 'doc-001';
export const PRD_FILE_NAME_RULE_HINT = '支持中文、英文、数字及 ._-；禁止 \\ / : * ? " < > | 等路径字符；最长 80 字';

export const PERSIST_DEBOUNCE_MS = 480;
export const TOAST_EXIT_MS = 220;
export const ACTIONBAR_OPEN_DELAY_MS = 56;
export const ACTIONBAR_SWITCH_DELAY_MS = 120;
export const ACTIONBAR_CLOSE_DELAY_MS = 140;
export const TABLE_HOVER_CLOSE_DELAY_MS = 140;
export const TABLE_EDGE_HOTZONE_PX = 24;
export const BUBBLE_GAP = 6;
export const BUBBLE_MARGIN = 8;
export const MERMAID_BLOCK_DEFAULT_WIDTH = 628;
export const MINDMAP_BLOCK_DEFAULT_WIDTH = 628;

export const HEADING_BLOCK_TYPES = Array.from({ length: 7 }, (_, index) => `h${index + 1}`);
export const BLOCK_LEVEL_TYPES = ['paragraph', ...HEADING_BLOCK_TYPES];
export const HEADING_BLOCK_TYPE_SET = new Set(HEADING_BLOCK_TYPES);
export const BLOCK_LEVEL_OPTIONS = BLOCK_LEVEL_TYPES.map((type) => ({
  value: type,
  label: type === 'paragraph' ? '正文' : type.toUpperCase(),
}));

export const BLOCK_TYPE_LABELS = {
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

export const ELEMENT_TYPE_LABELS = {
  text: '文本',
  image: '图片',
  mermaid: 'Mermaid 图表',
  mindmap: '思维导图',
};

export const PRD_SECTION_HEADERS = ['设计/原型稿', '交互', '逻辑'];

export const EMPTY_BLOCK_PERF_KEYS = {
  selectionKey: 'none',
  rowBindingsKey: '',
  imageMetaKey: '',
  annotationsKey: '',
  mermaidMetaKey: '',
  mindmapMetaKey: '',
};

export const LIGHTBOX_ZOOM_STEP = 0.05;
export const LIGHTBOX_ZOOM_MIN = 0.2;
export const LIGHTBOX_ZOOM_MAX = 5;
export const LIGHTBOX_ZOOM_PRESETS = [0.5, 0.75, 1, 1.5, 2, 3];
