export const SAVE_API = '/__prd__/save-md';
export const DELETE_IMAGE_API = '/__prd__/delete-image';
export const META_API = '/__prd__/meta';
export const SAVE_META_API = '/__prd__/save-meta';
export const ANNOTATIONS_API = '/__prd__/annotations';
export const SAVE_ANNOTATIONS_API = '/__prd__/save-annotations';
export const SAVE_ANNOTATION_ASSET_API = '/__prd__/save-annotation-asset';
export const DELETE_ANNOTATION_ASSET_API = '/__prd__/delete-annotation-asset';
export const PRD_EVENTS_API = '/__prd__/events';
export const ACTIVE_DOC_API = '/__prd__/active-doc';
export const LIST_DOCS_API = '/__prd__/list-docs';
export const CREATE_DOC_API = '/__prd__/create-doc';
export const SWITCH_DOC_API = '/__prd__/switch-doc';
export const TOC_OPEN_STORAGE_KEY = 'prd-editor:toc-open';

export const DEFAULT_PRD_SLUG = 'doc-001';
export const PRD_FILE_NAME_RULE_HINT = '仅支持小写英文、数字、.、_、-；空格和其它字符会自动转为 -';

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
