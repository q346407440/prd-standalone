import JSZip from 'jszip';
import { toSafeDocBaseName } from '../../../../shared/prd-filename-sanitize.js';
import { serializePrd } from './prd-writer.js';
import { serializePrdAsNativeMd } from './prd-export-native-md.js';
import { buildStandaloneHtml } from './prd-export-template.js';
import {
  normalizeAssetUrl,
  toExportAssetPath,
  toPreviewAssetPath,
  buildContentHtml,
  buildTocItems,
  buildTocTree,
  renderTreeNodes,
  collectPrdAssetUrls,
  extractDocTitle,
} from './prd-export-html-builders.js';

function toSafeAsciiBaseName(name, fallback = 'prd-export') {
  const ascii = String(name || '')
    .normalize('NFKD')
    .replace(/[^\x20-\x7E]+/g, '-')
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .toLowerCase()
    .slice(0, 80);
  return ascii || fallback;
}

function toExportPackageBaseName(name, asciiFallback) {
  const u = toSafeDocBaseName(name);
  if (u) return u;
  return toSafeAsciiBaseName(name, asciiFallback);
}

function toPreviewHtmlFileName(name, fallback) {
  const base = toExportPackageBaseName(name, fallback);
  return `${base}-preview.html`;
}

function toZipFileName(name, fallback) {
  const base = toExportPackageBaseName(name, fallback);
  return `${base}.zip`;
}

function escapeJsonForInlineScript(value) {
  return JSON.stringify(value, null, 2)
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e');
}

function getMdFileNameFromPath(mdPath, fallbackTitle) {
  const parts = String(mdPath || '').split('/');
  let fileName = parts[parts.length - 1] || '';
  try {
    fileName = decodeURIComponent(fileName);
  } catch {
    /* keep raw */
  }
  if (fileName.endsWith('.md')) {
    const fromPath = toSafeDocBaseName(getBaseName(fileName));
    if (fromPath) return `${fromPath}.md`;
    const fromFallback = toSafeDocBaseName(fallbackTitle);
    if (fromFallback) return `${fromFallback}.md`;
    return `${toSafeAsciiBaseName(fallbackTitle || 'prd-doc', 'prd-doc')}.md`;
  }
  const fb = toSafeDocBaseName(fallbackTitle) || toSafeAsciiBaseName(fallbackTitle || 'prd-doc', 'prd-doc');
  return `${fb}.md`;
}

function getBaseName(fileName) {
  return String(fileName || 'prd.md').replace(/\.md$/i, '');
}

function buildMetaPayload({ imageMeta, mermaidMeta, mindmapMeta }) {
  return {
    ...(imageMeta || {}),
    ...(mermaidMeta || {}),
    ...(mindmapMeta || {}),
  };
}

async function fetchAssetBlob(url, cache, activeSlug = '') {
  const normalized = normalizeAssetUrl(url, activeSlug);
  if (!normalized) {
    throw new Error(`非法资源路径：${url}`);
  }
  const cached = cache.get(normalized);
  if (cached) return cached;
  const promise = (async () => {
    const res = await fetch(normalized, { cache: 'no-store' });
    if (!res.ok) {
      throw new Error(`资源读取失败：${normalized}`);
    }
    return res.blob();
  })();
  cache.set(normalized, promise);
  try {
    return await promise;
  } catch (error) {
    cache.delete(normalized);
    throw error;
  }
}

export async function buildStandalonePrdExport({
  title,
  archiveName,
  blocks,
  activeSlug,
  mdPath,
  imageMeta,
  mermaidMeta,
  mindmapMeta,
  annotationsDoc,
  renderMermaidSvg,
  renderMindmapSvg,
}) {
  const docTitle = extractDocTitle(blocks, title);
  const exportSlug = activeSlug || 'doc-001';
  const exportBaseName =
    toSafeDocBaseName(docTitle) || toSafeAsciiBaseName(docTitle, `prd-${exportSlug}`);
  const mdFileName = getMdFileNameFromPath(mdPath, exportBaseName);
  const docBaseName = getBaseName(mdFileName);
  const metaPayload = buildMetaPayload({ imageMeta, mermaidMeta, mindmapMeta });
  const mdText = serializePrd(blocks || []);
  const annotationsPayload = annotationsDoc || {};
  const assetUrls = collectPrdAssetUrls(
    { activeSlug: exportSlug },
    mdText, metaPayload, annotationsPayload, blocks,
  );
  const assetPathMap = new Map(assetUrls.map((url) => [url, toPreviewAssetPath(url, exportSlug)]));
  const tocItems = buildTocItems(blocks);
  const tocTree = buildTocTree(tocItems);
  const contentHtml = await buildContentHtml(blocks, {
    imageMeta,
    mermaidMeta,
    mindmapMeta,
    renderMermaidSvg,
    renderMindmapSvg,
    assetPathMap,
    activeSlug: exportSlug,
  });
  const treeHtml = renderTreeNodes(tocTree);
  const previewFileName = toPreviewHtmlFileName(docTitle, exportBaseName);
  const previewDataFileName = 'preview-data.js';
  const exportedAtLabel = new Date().toLocaleString('zh-CN');
  const archiveFileName = toZipFileName(archiveName || docTitle, exportBaseName);
  const zip = new JSZip();
  const assetBlobCache = new Map();
  zip.file(previewFileName, buildStandaloneHtml({ title: docTitle }));
  zip.file(previewDataFileName, `window.__PRD_EXPORT_DATA__ = ${escapeJsonForInlineScript({
    title: docTitle,
    activeSlug: exportSlug,
    mdPath: `pages/${exportSlug}/${mdFileName}`,
    mdText,
    meta: metaPayload,
    annotations: annotationsPayload,
    treeHtml,
    contentHtml,
    preview: previewFileName,
    exportedAtLabel,
  })};\n`);
  zip.file('README.txt', [
    '本文件仅说明导出包内的文件关系，不约束具体使用方式。',
    '',
    '当前导出文档关系：',
    `- pages/.active-doc.json：当前激活文档指针；其中 slug=${exportSlug}`,
    `- pages/${exportSlug}/${mdFileName}：PRD 正文，是该文档的主内容文件`,
    `- pages/${exportSlug}/${docBaseName}.meta.json：展示元数据；用于记录图片宽度、Mermaid 视图模式/宽度、Mindmap 视图模式/宽度，不承载需求语义`,
    `- pages/${exportSlug}/${docBaseName}.meta.json 常见顶层字段：图片路径 -> width 映射、mermaidViewModes、mermaidWidths、mindmapViewModes、mindmapWidths`,
    `- pages/${exportSlug}/${docBaseName}.annotations.json：标注与增强输入；不是正文唯一真相，但与该文档同前缀关联`,
    `- pages/${exportSlug}/${docBaseName}.annotations.json 常见顶层字段：version、settings、assets，以及与标注/单元格状态相关的增强数据`,
    `- 上述 .md / .meta.json / .annotations.json 三个文件前缀一致，表示它们属于同一份 PRD 文档`,
    '',
    '预览与索引关系：',
    `- ${previewFileName}：离线预览入口`,
    '- preview-data.js：预览页使用的数据快照，包含本次导出的 md / meta / annotations / 渲染结果',
    '- export-manifest.json：导出包索引，声明 preview、source 与 assets 的路径映射关系',
    '',
    '素材关系：',
    `- pages/${exportSlug}/assets/：本次文档实际引用到的图片素材（与 MD 里的 ./assets/ 相对路径对齐）`,
    '- public/prd/：迁移期遗留的旧路径素材子集（仅当 MD 里仍有 /prd/ 引用时才会出现）',
    '- 这里导出的不是整个仓库素材目录，而是当前文档相关的素材子集',
  ].join('\n'));
  zip.file('pages/.active-doc.json', `${escapeJsonForInlineScript({ slug: exportSlug })}\n`);
  zip.file(`pages/${exportSlug}/${mdFileName}`, mdText);
  zip.file(`pages/${exportSlug}/${docBaseName}.meta.json`, `${JSON.stringify(metaPayload, null, 2)}\n`);
  zip.file(`pages/${exportSlug}/${docBaseName}.annotations.json`, `${JSON.stringify(annotationsPayload, null, 2)}\n`);
  zip.file('export-manifest.json', `${JSON.stringify({
    type: 'prd-offline-package',
    version: 1,
    exportedAt: new Date().toISOString(),
    title: docTitle,
    activeSlug: exportSlug,
    preview: previewFileName,
    previewData: previewDataFileName,
    source: {
      md: `pages/${exportSlug}/${mdFileName}`,
      meta: `pages/${exportSlug}/${docBaseName}.meta.json`,
      annotations: `pages/${exportSlug}/${docBaseName}.annotations.json`,
    },
    assets: assetUrls.map((url) => ({
      source: url,
      exported: toExportAssetPath(url, exportSlug),
    })),
  }, null, 2)}\n`);
  for (const assetUrl of assetUrls) {
    const exportPath = toExportAssetPath(assetUrl, exportSlug);
    if (!exportPath) continue;
    const blob = await fetchAssetBlob(assetUrl, assetBlobCache, exportSlug);
    zip.file(exportPath, blob);
  }
  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: archiveFileName,
    title: docTitle,
    previewFileName,
    blob,
  };
}

/**
 * 把任意输入路径映射成导出产物内的 `<assetDirName>/<file>`，
 * 与 native MD 正文里规范化后的相对路径 `./<assetDirName>/...` 保持一致。
 *   /pages/<slug>/assets/X → assets/X
 *   /prd/X                 → assets/X（迁移期遗留）
 */
function toNativeMdAssetPath(url, activeSlug, assetDirName = 'assets') {
  const normalized = normalizeAssetUrl(url, activeSlug);
  if (!normalized) return '';
  const docMatch = normalized.match(/^\/pages\/doc-\d+\/assets\/(.+)$/);
  if (docMatch) return `${assetDirName}/${docMatch[1]}`;
  if (normalized.startsWith('/prd/')) return `${assetDirName}/${normalized.slice('/prd/'.length)}`;
  return '';
}

/**
 * 抽出「原生 Markdown」导出包的文件树产物：.md 文本 + 拍平到 assets/ 的图片 Blob 列表。
 * 用于：
 *   - 导出原生 MD（打 zip）
 *   - 同步 SourceTree（把解压后的文件树直接镜像到本地目录）
 */
export async function buildNativeMdFileTree({
  title,
  blocks,
  activeSlug,
  mdPath,
  mdFileNameOverride = '',
  assetDirName = 'assets',
}) {
  const docTitle = extractDocTitle(blocks, title);
  const exportSlug = activeSlug || 'doc-001';
  const exportBaseName =
    toSafeDocBaseName(docTitle) || toSafeAsciiBaseName(docTitle, `prd-${exportSlug}`);
  const mdFileName = mdFileNameOverride || getMdFileNameFromPath(mdPath, exportBaseName);
  const nativeMdText = serializePrdAsNativeMd(blocks || [], { assetDirName });
  // 用原始正文（含原始路径形式）做资源收集，避免 native MD 已规范化后丢失 slug。
  const originalMd = serializePrd(blocks || []);
  const assetUrls = collectPrdAssetUrls(
    { activeSlug: exportSlug },
    originalMd, blocks,
  );
  const assetBlobCache = new Map();
  const assets = [];
  for (const assetUrl of assetUrls) {
    const exportPath = toNativeMdAssetPath(assetUrl, exportSlug, assetDirName);
    if (!exportPath) continue;
    const blob = await fetchAssetBlob(assetUrl, assetBlobCache, exportSlug);
    assets.push({ exportPath, blob });
  }
  return {
    docTitle,
    exportSlug,
    exportBaseName,
    mdFileName,
    nativeMdText,
    assets,
  };
}

/**
 * 构建「原生 Markdown」导出包：包含一份去掉 block 标记、表格转 GFM 的 .md 文件，
 * 以及该文档实际引用到的所有图片（统一拍平到 assets/ 目录，与正文里
 * 规范化后的 `./assets/<file>` 相对路径对齐）。
 */
export async function buildNativeMdPrdExport({
  title,
  archiveName,
  blocks,
  activeSlug,
  mdPath,
}) {
  const tree = await buildNativeMdFileTree({ title, blocks, activeSlug, mdPath });
  const archiveFileName = toZipFileName(archiveName || tree.docTitle, `${tree.exportBaseName}-md`);

  const zip = new JSZip();
  zip.file(tree.mdFileName, tree.nativeMdText);
  for (const { exportPath, blob } of tree.assets) {
    zip.file(exportPath, blob);
  }

  const blob = await zip.generateAsync({ type: 'blob' });
  return {
    fileName: archiveFileName,
    title: tree.docTitle,
    mdFileName: tree.mdFileName,
    blob,
  };
}

async function writeBlobToFileHandle(fileHandle, blob) {
  const writable = await fileHandle.createWritable();
  await writable.write(blob);
  await writable.close();
}

export async function saveStandalonePrdExportToDirectory({ fileName, blob }) {
  if (window.showSaveFilePicker) {
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: fileName,
      startIn: 'downloads',
      types: [
        {
          description: 'ZIP 压缩包',
          accept: { 'application/zip': ['.zip'] },
        },
      ],
    });
    await writeBlobToFileHandle(fileHandle, blob);
    return { fileName };
  }
  throw new Error('当前浏览器不支持保存 ZIP 文件');
}

export function downloadStandalonePrdExport({ fileName, blob }) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}
