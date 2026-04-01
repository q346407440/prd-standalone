const ANNOTATIONS_VERSION = 1;

const DEFAULT_SETTINGS = {
  defaultGenerateColumns: ['interaction', 'logic'],
  defaultChangeType: 'iterate',
  defaultGranularity: 'list',
};

const VALID_CHANGE_TYPES = ['new_feature', 'page_addition', 'iterate', 'existing'];
const LEGACY_CHANGE_TYPE_MAP = {
  new: 'page_addition',
};

const DEFAULT_IGNORE_TAGS = [
  'app-layout',
  '页头页脚',
  '历史已有功能',
  '公共容器',
  '装饰性内容',
  '非本次迭代范围',
];

const DEFAULT_CELL_CHANGE_INTENT = 'default';

let _regionSeq = 0;

function sanitizeSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

function sanitizeAsciiSegment(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    || 'untitled';
}

function basenameFromSrc(src) {
  const clean = String(src || '').split('?')[0];
  const parts = clean.split('/');
  return parts[parts.length - 1] || 'image';
}

function assetIdFromSrc(src) {
  return `asset-${sanitizeSegment(basenameFromSrc(src).replace(/\.[^.]+$/, ''))}`;
}

function makeRegionId() {
  _regionSeq += 1;
  return `region-${Date.now()}-${_regionSeq}`;
}

function normalizeSettings(settings) {
  return {
    ...DEFAULT_SETTINGS,
    ...(settings && typeof settings === 'object' ? settings : {}),
  };
}

function normalizeChangeType(changeType, fallback = DEFAULT_SETTINGS.defaultChangeType) {
  const next = LEGACY_CHANGE_TYPE_MAP[changeType] || changeType;
  return VALID_CHANGE_TYPES.includes(next) ? next : fallback;
}

/** 记住「生成列 / 变更类型」表单默认值，供连续标注多张图时复用 */
const REGION_FORM_DEFAULTS_STORAGE_KEY = 'prd-standalone.regionFormDefaults.v1';

function parseStoredRegionFormDefaults() {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(REGION_FORM_DEFAULTS_STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    const out = {};
    if (Array.isArray(data.defaultGenerateColumns)) {
      const cols = [...new Set(
        data.defaultGenerateColumns.filter((item) => item === 'interaction' || item === 'logic'),
      )];
      if (cols.length) out.defaultGenerateColumns = cols;
    }
    const normalizedChangeType = normalizeChangeType(data.defaultChangeType, '');
    if (normalizedChangeType) {
      out.defaultChangeType = normalizedChangeType;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}

/** 侧车里的 settings 与本地记住的表单默认合并（仅影响新建区域的初始值） */
export function mergeAnnotationSettingsWithLocalStorage(rawSettings) {
  const base = normalizeSettings(rawSettings);
  const stored = parseStoredRegionFormDefaults();
  if (!stored) return base;
  return { ...base, ...stored };
}

/** 保存标注成功后写入 localStorage（取当前图中最后一个区域的配置，与常见「最后改动的框」一致） */
export function persistRegionFormDefaultsFromRegions(rawRegions, rawSettings) {
  if (typeof localStorage === 'undefined') return;
  if (!Array.isArray(rawRegions) || rawRegions.length === 0) return;
  const settings = normalizeSettings(rawSettings);
  const normalized = rawRegions.map((item) => normalizeRegion(item, settings));
  const pick = normalized[normalized.length - 1];
  try {
    localStorage.setItem(
      REGION_FORM_DEFAULTS_STORAGE_KEY,
      JSON.stringify({
        v: 1,
        defaultGenerateColumns: pick.generateColumns,
        defaultChangeType: pick.changeType,
      }),
    );
  } catch {
    // 隐私模式 / 配额等
  }
}

function normalizeOutputHint(hint, fallbackTitle = '') {
  return {
    groupTitle: typeof hint?.groupTitle === 'string' ? hint.groupTitle : fallbackTitle,
    order: Number.isFinite(hint?.order) ? hint.order : 0,
  };
}

function normalizeRegion(region, settings = DEFAULT_SETTINGS) {
  const title = typeof region?.title === 'string' ? region.title : '';
  let inScope = region?.inScope !== false;
  const fallbackChangeType = normalizeChangeType(settings.defaultChangeType, DEFAULT_SETTINGS.defaultChangeType);
  let changeType = region?.changeType;
  if (changeType === 'ignore') {
    inScope = false;
    changeType = fallbackChangeType;
  } else {
    changeType = normalizeChangeType(changeType, fallbackChangeType);
  }
  return {
    regionId: typeof region?.regionId === 'string' ? region.regionId : makeRegionId(),
    usageId: typeof region?.usageId === 'string' ? region.usageId : '',
    label: typeof region?.label === 'string' ? region.label : '',
    title,
    bbox: {
      x: Number(region?.bbox?.x) || 0,
      y: Number(region?.bbox?.y) || 0,
      w: Number(region?.bbox?.w) || 0,
      h: Number(region?.bbox?.h) || 0,
    },
    inScope,
    generateColumns: Array.isArray(region?.generateColumns) && region.generateColumns.length
      ? [...new Set(region.generateColumns.filter((item) => item === 'interaction' || item === 'logic'))]
      : [...settings.defaultGenerateColumns],
    changeType,
    granularity: ['page', 'section', 'list', 'item', 'control'].includes(region?.granularity)
      ? region.granularity
      : settings.defaultGranularity,
    sortOrder: Number.isFinite(region?.sortOrder) ? region.sortOrder : 0,
    ignoreTags: Array.isArray(region?.ignoreTags)
      ? [...new Set(region.ignoreTags.map((item) => String(item)).filter(Boolean))]
      : [],
    note: typeof region?.note === 'string' ? region.note : '',
    outputHints: {
      interaction: normalizeOutputHint(region?.outputHints?.interaction, title),
      logic: normalizeOutputHint(region?.outputHints?.logic, title),
    },
  };
}

function normalizeUsage(usage) {
  return {
    usageId: typeof usage?.usageId === 'string' ? usage.usageId : '',
    assetId: typeof usage?.assetId === 'string' ? usage.assetId : '',
    sourceImageSrc: typeof usage?.sourceImageSrc === 'string' ? usage.sourceImageSrc : '',
    docPath: typeof usage?.docPath === 'string' ? usage.docPath : '/pages/prd/prd.md',
    tableKey: typeof usage?.tableKey === 'string' ? usage.tableKey : '',
    rowKey: typeof usage?.rowKey === 'string' ? usage.rowKey : '',
    sectionTitle: typeof usage?.sectionTitle === 'string' ? usage.sectionTitle : '',
    tableColumn: typeof usage?.tableColumn === 'string' ? usage.tableColumn : 'design',
    rowIndex: Number.isFinite(usage?.rowIndex) ? usage.rowIndex : 0,
    imageIndex: Number.isFinite(usage?.imageIndex) ? usage.imageIndex : 0,
    enabled: usage?.enabled !== false,
    isBeforeIteration: Boolean(usage?.isBeforeIteration),
  };
}

function normalizeAsset(asset) {
  return {
    assetId: typeof asset?.assetId === 'string' ? asset.assetId : '',
    src: typeof asset?.src === 'string' ? asset.src : '',
    fileName: typeof asset?.fileName === 'string' ? asset.fileName : '',
    width: Number.isFinite(asset?.width) ? asset.width : 0,
    height: Number.isFinite(asset?.height) ? asset.height : 0,
    mimeType: typeof asset?.mimeType === 'string' ? asset.mimeType : '',
    status: typeof asset?.status === 'string' ? asset.status : 'active',
  };
}

function normalizeDerivedAsset(asset) {
  return {
    derivedId: typeof asset?.derivedId === 'string' ? asset.derivedId : '',
    usageId: typeof asset?.usageId === 'string' ? asset.usageId : '',
    regionId: typeof asset?.regionId === 'string' ? asset.regionId : '',
    focusSrc: typeof asset?.focusSrc === 'string' ? asset.focusSrc : '',
    cropSrc: typeof asset?.cropSrc === 'string' ? asset.cropSrc : '',
    status: typeof asset?.status === 'string' ? asset.status : 'active',
  };
}

function normalizeCellState(state) {
  const normalizeColumnState = (columnState) => {
    const locked = Boolean(columnState?.locked);
    const pendingConfirm = Boolean(columnState?.pendingConfirm);
    return {
      locked,
      source: typeof columnState?.source === 'string' ? columnState.source : 'manual',
      changeIntent: locked || columnState?.changeIntent === 'unchanged'
        ? 'unchanged'
        : DEFAULT_CELL_CHANGE_INTENT,
      pendingConfirm,
      pendingConfirmNote: typeof columnState?.pendingConfirmNote === 'string'
        ? columnState.pendingConfirmNote
        : '',
    };
  };
  return {
    usageId: typeof state?.usageId === 'string' ? state.usageId : '',
    rowKey: typeof state?.rowKey === 'string' ? state.rowKey : '',
    interaction: normalizeColumnState(state?.interaction),
    logic: normalizeColumnState(state?.logic),
  };
}

export function createEmptyAnnotationsDoc() {
  return {
    version: ANNOTATIONS_VERSION,
    settings: { ...DEFAULT_SETTINGS },
    assets: [],
    usages: [],
    regions: [],
    derivedAssets: [],
    cellStates: [],
  };
}

export function normalizeAnnotationsDoc(raw) {
  const base = raw && typeof raw === 'object' ? raw : {};
  const settings = normalizeSettings(base.settings);
  return {
    version: Number.isFinite(base.version) ? base.version : ANNOTATIONS_VERSION,
    settings,
    assets: Array.isArray(base.assets) ? base.assets.map(normalizeAsset) : [],
    usages: Array.isArray(base.usages) ? base.usages.map(normalizeUsage) : [],
    regions: Array.isArray(base.regions) ? base.regions.map((item) => normalizeRegion(item, settings)) : [],
    derivedAssets: Array.isArray(base.derivedAssets)
      ? base.derivedAssets.map(normalizeDerivedAsset)
      : [],
    cellStates: Array.isArray(base.cellStates) ? base.cellStates.map(normalizeCellState) : [],
  };
}

export function getCellColumnKey(headers, ci) {
  const header = String(headers?.[ci] || '').trim();
  if (/交互/.test(header)) return 'interaction';
  if (/逻辑/.test(header)) return 'logic';
  if (/设计|原型/.test(header)) return 'design';
  return `col-${ci + 1}`;
}

export function getDesignColumnIndex(headers) {
  const idx = headers.findIndex((header) => /设计|原型/.test(String(header || '').trim()));
  return idx >= 0 ? idx : 0;
}

export function getCellElements(cell) {
  if (!cell) return [];
  if (Array.isArray(cell.elements)) return cell.elements;
  if (cell.element) return [cell.element];
  return [];
}

export function getImageElementsFromCell(cell) {
  return getCellElements(cell).reduce((list, element, elementIdx) => {
    if (element?.type !== 'image' || !element?.src) return list;
    list.push({
      element,
      elementIdx,
      imageIndex: list.length,
    });
    return list;
  }, []);
}

export function buildTableBindings(blocks) {
  const usages = [];
  const rows = [];
  let currentSectionTitle = '';
  let sectionTableIndex = 0;

  (blocks || []).forEach((block) => {
    if (block?.type === 'h2') {
      currentSectionTitle = block.content?.markdown || '';
      sectionTableIndex = 0;
      return;
    }
    if (block?.type !== 'table') return;

    sectionTableIndex += 1;
    const sectionSlug = sanitizeSegment(currentSectionTitle || `section-${sectionTableIndex}`);
    const tableKey = `${sectionSlug}__table-${sectionTableIndex}`;
    const headers = block.content?.headers || [];
    const rowsData = block.content?.rows || [];
    const designCi = getDesignColumnIndex(headers);

    rowsData.forEach((row, ri) => {
      const rowKey = `${tableKey}__row-${ri + 1}`;
      const designCell = row?.[designCi];
      const images = getImageElementsFromCell(designCell);
      rows.push({
        blockId: block.id,
        tableKey,
        rowKey,
        rowIndex: ri,
        sectionTitle: currentSectionTitle,
        headers,
        designCi,
        imageCount: images.length,
      });
      images.forEach(({ element, imageIndex }) => {
        usages.push({
          usageId: `${rowKey}__usage-${imageIndex + 1}`,
          assetId: assetIdFromSrc(element.src),
          sourceImageSrc: element.src,
          docPath: '/pages/prd/prd.md',
          tableKey,
          rowKey,
          sectionTitle: currentSectionTitle,
          tableColumn: 'design',
          rowIndex: ri,
          imageIndex,
          enabled: true,
        });
      });
    });
  });

  return { rows, usages };
}

export function reconcileAnnotationsWithBlocks(rawDoc, blocks) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const bindings = buildTableBindings(blocks);
  const usageIds = new Set(bindings.usages.map((item) => item.usageId));
  const rowKeys = new Set(bindings.rows.map((item) => item.rowKey));
  const regionIds = new Set(
    doc.regions
      .filter((region) => usageIds.has(region.usageId))
      .map((region) => region.regionId)
  );
  const prevDerivedByRegion = new Map(
    doc.derivedAssets.map((item) => [item.regionId, item])
  );
  const nextUsages = bindings.usages.map((usage) => {
    const prev = doc.usages.find((item) => item.usageId === usage.usageId);
    return normalizeUsage({ ...prev, ...usage });
  });
  const nextRegions = doc.regions
    .filter((region) => usageIds.has(region.usageId))
    .map((region) => normalizeRegion(region, doc.settings));
  const nextDerivedAssets = doc.derivedAssets
    .filter((asset) => usageIds.has(asset.usageId) && regionIds.has(asset.regionId))
    .map(normalizeDerivedAsset);
  const nextCellStates = doc.cellStates
    .filter((item) => rowKeys.has(item.rowKey))
    .map(normalizeCellState);

  const currentAssets = new Map(doc.assets.map((item) => [item.src, item]));
  const nextAssets = [];
  const seenAssets = new Set();
  nextUsages.forEach((usage) => {
    if (!usage.sourceImageSrc || seenAssets.has(usage.sourceImageSrc)) return;
    seenAssets.add(usage.sourceImageSrc);
    const prev = currentAssets.get(usage.sourceImageSrc);
    nextAssets.push(normalizeAsset({
      assetId: assetIdFromSrc(usage.sourceImageSrc),
      src: usage.sourceImageSrc,
      fileName: basenameFromSrc(usage.sourceImageSrc),
      ...(prev || {}),
      status: 'active',
    }));
  });

  const removedRegionIds = new Set(
    doc.regions
      .filter((region) => !usageIds.has(region.usageId))
      .map((region) => region.regionId)
  );
  const removedDerivedPaths = doc.derivedAssets
    .filter((asset) => removedRegionIds.has(asset.regionId) || !usageIds.has(asset.usageId))
    .flatMap((asset) => [asset.focusSrc, asset.cropSrc].filter(Boolean));

  const nextDoc = {
    ...doc,
    assets: nextAssets,
    usages: nextUsages,
    regions: nextRegions,
    derivedAssets: nextDerivedAssets,
    cellStates: nextCellStates,
  };

  return {
    doc: nextDoc,
    bindings,
    removedDerivedPaths: [...new Set(removedDerivedPaths)],
    derivedByRegion: prevDerivedByRegion,
  };
}

export function updateAssetMetadata(rawDoc, src, patch) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const assetId = assetIdFromSrc(src);
  const current = doc.assets.find((item) => item.src === src);
  const nextAsset = normalizeAsset({
    assetId,
    src,
    fileName: basenameFromSrc(src),
    ...(current || {}),
    ...(patch || {}),
  });
  const others = doc.assets.filter((item) => item.src !== src);
  return {
    ...doc,
    assets: [...others, nextAsset],
  };
}

export function updateUsageMetadata(rawDoc, usageId, patch) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const current = doc.usages.find((item) => item.usageId === usageId);
  if (!current) return doc;
  const nextUsage = normalizeUsage({
    ...current,
    ...(patch || {}),
    usageId: current.usageId,
  });
  return {
    ...doc,
    usages: doc.usages.map((item) => (item.usageId === usageId ? nextUsage : item)),
  };
}

export function getUsageRegions(doc, usageId) {
  return normalizeAnnotationsDoc(doc).regions
    .filter((region) => region.usageId === usageId)
    .sort((a, b) => {
      const orderDelta = a.sortOrder - b.sortOrder;
      if (orderDelta !== 0) return orderDelta;
      return a.label.localeCompare(b.label, 'zh-CN');
    });
}

export function nextRegionLabel(regions) {
  return `区域${(regions || []).length + 1}`;
}

export function relabelRegions(regions) {
  return (regions || []).map((region, index) => {
    const name = `区域${index + 1}`;
    return {
      ...region,
      label: name,
      title: name,
      outputHints: {
        interaction: {
          ...(region.outputHints?.interaction || {}),
          groupTitle: name,
        },
        logic: {
          ...(region.outputHints?.logic || {}),
          groupTitle: name,
        },
      },
    };
  });
}

export function createRegionDraft(usageId, existingRegions, settings = DEFAULT_SETTINGS) {
  const label = nextRegionLabel(existingRegions || []);
  return normalizeRegion({
    regionId: makeRegionId(),
    usageId,
    label,
    title: label,
    bbox: { x: 0, y: 0, w: 0, h: 0 },
    inScope: true,
    generateColumns: [...settings.defaultGenerateColumns],
    changeType: settings.defaultChangeType,
    granularity: settings.defaultGranularity,
    sortOrder: (existingRegions?.length || 0) + 1,
    ignoreTags: [],
    note: '',
    outputHints: {
      interaction: { groupTitle: label, order: (existingRegions?.length || 0) + 1 },
      logic: { groupTitle: label, order: (existingRegions?.length || 0) + 1 },
    },
  }, settings);
}

export function upsertUsageRegions(rawDoc, usageId, regions) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const normalized = relabelRegions(regions)
    .map((region) => normalizeRegion({ ...region, usageId }, doc.settings));
  const others = doc.regions.filter((item) => item.usageId !== usageId);
  const validRegionIds = new Set(normalized.map((item) => item.regionId));
  return {
    ...doc,
    regions: [...others, ...normalized],
    derivedAssets: doc.derivedAssets.filter((item) => item.usageId !== usageId || validRegionIds.has(item.regionId)),
  };
}

export function upsertDerivedAsset(rawDoc, payload) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const normalized = normalizeDerivedAsset(payload);
  const others = doc.derivedAssets.filter((item) => item.regionId !== normalized.regionId);
  return {
    ...doc,
    derivedAssets: [...others, normalized],
  };
}

export function buildDerivedAssetNames(usageId, regionId) {
  const base = `${sanitizeAsciiSegment(usageId)}__${sanitizeAsciiSegment(regionId)}`;
  return {
    focusFileName: `${base}__focus.png`,
    cropFileName: `${base}__crop.png`,
    focusSrc: `/prd/annotations/${base}__focus.png`,
    cropSrc: `/prd/annotations/${base}__crop.png`,
  };
}

export function toggleCellLocked(rawDoc, rowKey, usageId, columnKey) {
  return patchCellColumnState(rawDoc, rowKey, usageId, columnKey, (currentColumn) => ({
    locked: !currentColumn?.locked,
  }));
}

function patchCellColumnState(rawDoc, rowKey, usageId, columnKey, patchOrFactory) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  const existing = doc.cellStates.find((item) => item.rowKey === rowKey)
    || normalizeCellState({ rowKey, usageId });
  const currentColumn = existing[columnKey] || {};
  const patch = typeof patchOrFactory === 'function'
    ? patchOrFactory(currentColumn, existing)
    : patchOrFactory;
  const next = {
    ...existing,
    usageId: usageId || existing.usageId,
    [columnKey]: {
      ...currentColumn,
      ...(patch || {}),
    },
  };
  return {
    ...doc,
    cellStates: [
      ...doc.cellStates.filter((item) => item.rowKey !== rowKey),
      normalizeCellState(next),
    ],
  };
}

export function markCellSource(rawDoc, rowKey, usageId, columnKey, source) {
  return patchCellColumnState(rawDoc, rowKey, usageId, columnKey, { source });
}

export function setCellChangeIntent(rawDoc, rowKey, usageId, columnKey, changeIntent) {
  return patchCellColumnState(rawDoc, rowKey, usageId, columnKey, {
    locked: false,
    changeIntent: changeIntent === 'unchanged' ? 'unchanged' : DEFAULT_CELL_CHANGE_INTENT,
  });
}

export function setCellPendingConfirm(rawDoc, rowKey, usageId, columnKey, pendingConfirm) {
  return patchCellColumnState(rawDoc, rowKey, usageId, columnKey, (currentColumn) => ({
    pendingConfirm: Boolean(pendingConfirm),
    pendingConfirmNote: pendingConfirm ? (currentColumn?.pendingConfirmNote || '') : '',
  }));
}

export function setCellPendingConfirmNote(rawDoc, rowKey, usageId, columnKey, note) {
  return patchCellColumnState(rawDoc, rowKey, usageId, columnKey, (currentColumn) => ({
    pendingConfirm: true,
    pendingConfirmNote: typeof note === 'string' ? note : '',
    changeIntent: currentColumn?.changeIntent ?? DEFAULT_CELL_CHANGE_INTENT,
    locked: Boolean(currentColumn?.locked),
    source: currentColumn?.source || 'manual',
  }));
}

export function getCellState(rawDoc, rowKey) {
  const doc = normalizeAnnotationsDoc(rawDoc);
  return doc.cellStates.find((item) => item.rowKey === rowKey)
    || normalizeCellState({ rowKey, usageId: '' });
}

export {
  ANNOTATIONS_VERSION,
  DEFAULT_CELL_CHANGE_INTENT,
  DEFAULT_IGNORE_TAGS,
  DEFAULT_SETTINGS,
  VALID_CHANGE_TYPES,
  assetIdFromSrc,
  basenameFromSrc,
  sanitizeAsciiSegment,
  sanitizeSegment,
};
