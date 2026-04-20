import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFeishuSyncApi } from './feishu-sync-server.js';
import { createDocHandlers } from './server/prd-doc-handlers.js';
import { createFileHandlers } from './server/prd-file-handlers.js';
import { createPrdLiveSync } from './server/prd-live-sync.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const API_IMAGE = '/__prd__/save-image';
const API_DELETE_IMAGE = '/__prd__/delete-image';
const API_MD = '/__prd__/save-md';
const API_META = '/__prd__/meta';
const API_SAVE_META = '/__prd__/save-meta';
const API_ANNOTATIONS = '/__prd__/annotations';
const API_SAVE_ANNOTATIONS = '/__prd__/save-annotations';
const API_SAVE_ANNOTATION_ASSET = '/__prd__/save-annotation-asset';
const API_DELETE_ANNOTATION_ASSET = '/__prd__/delete-annotation-asset';
const API_EVENTS = '/__prd__/events';
const API_LIST_DOCS = '/__prd__/list-docs';
const API_CREATE_DOC = '/__prd__/create-doc';
const API_SWITCH_DOC = '/__prd__/switch-doc';
const API_ACTIVE_DOC = '/__prd__/active-doc';
const API_RENAME_DOC = '/__prd__/rename-doc';
const API_BACKUP_DOC = '/__prd__/backup-doc';
const API_SYNC_NATIVE_MD = '/__prd__/sync-native-md';

const PRD_PAGES_DIR = path.join(__dirname, 'pages');
const PRD_ACTIVE_FILE = path.join(__dirname, 'pages', '.active-doc.json');
const PRD_ANNOTATION_ASSET_DIR = path.join(__dirname, 'public', 'prd', 'annotations');

function attachMiddleware(server, liveSync, docHandlers, fileHandlers) {
  const feishuSyncApi = createFeishuSyncApi({
    rootDir: __dirname,
    publicDir: path.join(__dirname, 'public'),
  });

  server.middlewares.use((req, res, next) => {
    const pathOnly = decodeURIComponent(String(req.url || '').split('?')[0]);

    // ── 多文档 API ──
    if (pathOnly === API_LIST_DOCS && req.method === 'GET') {
      docHandlers.listDocs(req, res);
      return;
    }
    if (pathOnly === API_CREATE_DOC && req.method === 'POST') {
      const origEnd = res.end.bind(res);
      res.end = (...args) => { origEnd(...args); liveSync.rewatchActiveDoc(); };
      docHandlers.createDoc(req, res);
      return;
    }
    if (pathOnly === API_SWITCH_DOC && req.method === 'POST') {
      const origEnd = res.end.bind(res);
      res.end = (...args) => { origEnd(...args); liveSync.rewatchActiveDoc(); };
      docHandlers.switchDoc(req, res);
      return;
    }
    if (pathOnly === API_RENAME_DOC && req.method === 'POST') {
      const origEnd = res.end.bind(res);
      res.end = (...args) => { origEnd(...args); liveSync.rewatchActiveDoc(); };
      docHandlers.renameDoc(req, res);
      return;
    }
    if (pathOnly === API_ACTIVE_DOC && req.method === 'GET') {
      docHandlers.activeDoc(req, res);
      return;
    }
    if (pathOnly === API_BACKUP_DOC && req.method === 'POST') {
      fileHandlers.backupDoc(req, res);
      return;
    }
    if (pathOnly === API_BACKUP_DOC && req.method === 'GET') {
      fileHandlers.getBackupDocDir(req, res);
      return;
    }
    if (pathOnly === API_SYNC_NATIVE_MD && req.method === 'POST') {
      fileHandlers.syncNativeMd(req, res);
      return;
    }

    // GET /pages/:slug/*.md → 任意 slug 的 PRD 正文
    const mdMatch = pathOnly.match(/^\/pages\/([^/]+)\/(.+\.md)$/);
    if (mdMatch && req.method === 'GET') {
      fileHandlers.readMd(req, res, mdMatch[1]);
      return;
    }
    // GET /pages/:slug/assets/:file → doc 自带的 colocated 图片
    const assetMatch = pathOnly.match(/^\/pages\/(doc-\d+)\/assets\/([^/]+)$/);
    if (assetMatch && req.method === 'GET') {
      fileHandlers.readDocAsset(req, res, assetMatch[1], assetMatch[2]);
      return;
    }

    if (pathOnly === API_IMAGE && req.method === 'POST') {
      fileHandlers.saveImage(req, res);
      return;
    }
    if (pathOnly === API_DELETE_IMAGE && req.method === 'POST') {
      fileHandlers.deleteImage(req, res);
      return;
    }
    if (pathOnly === API_MD && req.method === 'POST') {
      fileHandlers.saveMd(req, res, { liveSync });
      return;
    }
    if (pathOnly === API_META && req.method === 'GET') {
      fileHandlers.getMeta(req, res);
      return;
    }
    if (pathOnly === API_SAVE_META && req.method === 'POST') {
      fileHandlers.saveMeta(req, res);
      return;
    }
    if (pathOnly === API_ANNOTATIONS && req.method === 'GET') {
      fileHandlers.getAnnotations(req, res);
      return;
    }
    if (pathOnly === API_SAVE_ANNOTATIONS && req.method === 'POST') {
      fileHandlers.saveAnnotations(req, res, { liveSync });
      return;
    }
    if (pathOnly === API_SAVE_ANNOTATION_ASSET && req.method === 'POST') {
      fileHandlers.saveAnnotationAsset(req, res);
      return;
    }
    if (pathOnly === API_DELETE_ANNOTATION_ASSET && req.method === 'POST') {
      fileHandlers.deleteAnnotationAsset(req, res);
      return;
    }
    if (pathOnly === API_EVENTS && req.method === 'GET') {
      liveSync.handleEvents(req, res);
      return;
    }

    if (feishuSyncApi.matches(pathOnly)) {
      feishuSyncApi.handle(req, res).catch((error) => {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: false,
          error: error?.message || String(error),
        }));
      });
      return;
    }

    next();
  });
}

/**
 * 启动时扫描 pages/<slug>/*.md，统计仍在引用旧 /prd/ 路径的文件。
 * 仅打印 banner 提示，不阻塞启动 —— 用户自行决定是否跑 npm run migrate-assets。
 */
function scanLegacyPrdRefsBanner(pagesDir) {
  if (!fs.existsSync(pagesDir)) return;
  const slugs = fs.readdirSync(pagesDir).filter((n) => /^doc-\d+$/.test(n));
  const offenders = [];
  for (const slug of slugs) {
    const dir = path.join(pagesDir, slug);
    let entries;
    try { entries = fs.readdirSync(dir); } catch { continue; }
    for (const name of entries) {
      if (!name.endsWith('.md')) continue;
      const full = path.join(dir, name);
      try {
        const text = fs.readFileSync(full, 'utf8');
        const matches = text.match(/\/prd\/[^)\s"'<>]+\.(?:png|jpe?g|gif|webp|svg|bmp)/gi);
        if (matches && matches.length) {
          offenders.push({ slug, file: name, count: matches.length });
        }
      } catch { /* ignore */ }
    }
  }
  if (!offenders.length) return;
  const lines = [
    '╭─ PRD assets migration 提示 ──────────────────────────────────────',
    '│ 检测到以下 MD 仍在使用旧的 /prd/ 绝对路径，建议迁移到 colocated 资产目录：',
    '│',
    ...offenders.map((o) => `│   • pages/${o.slug}/${o.file}  (${o.count} refs)`),
    '│',
    '│ 运行：  npm run migrate-assets -- --dry-run   先看报告',
    '│ 然后：  npm run migrate-assets               真正迁移（自动备份原 MD）',
    '│ 后端兼容期会继续服务 /prd/ 与 ./assets/ 两种路径，不影响开发。',
    '╰──────────────────────────────────────────────────────────────────',
  ];
  console.log('\n' + lines.join('\n') + '\n');
}

/**
 * 开发 / 预览时：保存 PRD 截图到 pages/<slug>/assets/，页面通过 /pages/<slug>/assets/文件名 访问。
 * 兼容期同时保留 /prd/ 旧路径（public/prd/ 仍由 Vite 服务）。
 */
export function prdSaveImagePlugin() {
  const ctx = {
    pagesDir: PRD_PAGES_DIR,
    activeFile: PRD_ACTIVE_FILE,
    annotationAssetDir: PRD_ANNOTATION_ASSET_DIR,
    rootDir: __dirname,
    publicPrdDir: path.join(__dirname, 'public', 'prd'),
  };

  const liveSync = createPrdLiveSync(ctx);
  const docHandlers = createDocHandlers(ctx);
  const fileHandlers = createFileHandlers(ctx);

  return {
    name: 'prd-save-image',
    configureServer(server) {
      scanLegacyPrdRefsBanner(PRD_PAGES_DIR);
      liveSync.start();
      server.httpServer?.once('close', () => liveSync.stop());
      attachMiddleware(server, liveSync, docHandlers, fileHandlers);
    },
    configurePreviewServer(server) {
      liveSync.start();
      server.httpServer?.once('close', () => liveSync.stop());
      attachMiddleware(server, liveSync, docHandlers, fileHandlers);
    },
  };
}
