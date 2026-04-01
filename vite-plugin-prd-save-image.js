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

    // GET /pages/:slug/*.md → 任意 slug 的 PRD 正文
    const mdMatch = pathOnly.match(/^\/pages\/([^/]+)\/(.+\.md)$/);
    if (mdMatch && req.method === 'GET') {
      fileHandlers.readMd(req, res, mdMatch[1]);
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
      fileHandlers.saveAnnotations(req, res);
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
 * 开发 / 预览时：把 PRD 截图保存到 public/prd/，页面通过 /prd/文件名 访问。
 */
export function prdSaveImagePlugin() {
  const ctx = {
    pagesDir: PRD_PAGES_DIR,
    activeFile: PRD_ACTIVE_FILE,
    annotationAssetDir: PRD_ANNOTATION_ASSET_DIR,
    rootDir: __dirname,
  };

  const liveSync = createPrdLiveSync(ctx);
  const docHandlers = createDocHandlers(ctx);
  const fileHandlers = createFileHandlers(ctx);

  return {
    name: 'prd-save-image',
    configureServer(server) {
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
