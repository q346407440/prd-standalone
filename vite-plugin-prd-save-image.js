import { Buffer } from 'node:buffer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createFeishuSyncApi } from './feishu-sync-server.js';

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

/** PRD 所有文档的根目录 */
const PRD_PAGES_DIR = path.join(__dirname, 'pages');
/** 当前激活文档的索引文件 */
const PRD_ACTIVE_FILE = path.join(__dirname, 'pages', '.active-doc.json');

const PRD_ANNOTATION_ASSET_DIR = path.join(__dirname, 'public', 'prd', 'annotations');

// ─── 多文档辅助 ──────────────────────────────────────────────────────────────

/** 读取当前激活文档的 slug，默认 'doc-001' */
function readActiveDocSlug() {
  try {
    if (fs.existsSync(PRD_ACTIVE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PRD_ACTIVE_FILE, 'utf8'));
      if (typeof data.slug === 'string' && data.slug) return data.slug;
    }
  } catch {}
  return 'doc-001';
}

/** 写入当前激活文档的 slug */
function writeActiveDocSlug(slug) {
  fs.mkdirSync(PRD_PAGES_DIR, { recursive: true });
  fs.writeFileSync(PRD_ACTIVE_FILE, JSON.stringify({ slug }, null, 2), 'utf8');
}

/** 扫描 pages/ 目录，返回下一个可用的 doc-NNN slug */
function nextSlug() {
  let max = 0;
  if (fs.existsSync(PRD_PAGES_DIR)) {
    for (const d of fs.readdirSync(PRD_PAGES_DIR, { withFileTypes: true })) {
      if (!d.isDirectory()) continue;
      const m = d.name.match(/^doc-(\d+)$/);
      if (m) max = Math.max(max, parseInt(m[1], 10));
    }
  }
  return `doc-${String(max + 1).padStart(3, '0')}`;
}

/**
 * 找到 pages/<slug>/ 目录下的实际 .md 文件路径。
 * 每个 slug 目录只有一个 .md 文件。
 * 若目录不存在或无 .md 文件返回 null。
 */
function findDocMdFile(slug) {
  const docDir = path.join(PRD_PAGES_DIR, slug);
  if (!fs.existsSync(docDir)) return null;
  const files = fs.readdirSync(docDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return null;
  return path.join(docDir, files[0]);
}

/**
 * 从文件路径中提取展示用的 title（文件名去掉 .md 后缀）。
 */
function mdFileToTitle(mdFilePath) {
  return path.basename(mdFilePath, '.md');
}

/** 根据 .md 文件路径推导同目录下的 .meta.json 路径 */
function mdFileToMetaPath(mdFilePath) {
  const dir = path.dirname(mdFilePath);
  const base = path.basename(mdFilePath, '.md');
  return path.join(dir, `${base}.meta.json`);
}

/** 根据 .md 文件路径推导同目录下的 .annotations.json 路径 */
function mdFileToAnnotationsPath(mdFilePath) {
  const dir = path.dirname(mdFilePath);
  const base = path.basename(mdFilePath, '.md');
  return path.join(dir, `${base}.annotations.json`);
}

/** 列出所有 PRD 文档（pages/ 下每个含 .md 文件的子目录），title = 文件名（去后缀） */
function listDocs() {
  const activeSlug = readActiveDocSlug();
  const dirs = fs.readdirSync(PRD_PAGES_DIR, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs
    .map(slug => {
      const mdFile = findDocMdFile(slug);
      if (!mdFile) return null;
      return { slug, title: mdFileToTitle(mdFile), active: slug === activeSlug };
    })
    .filter(Boolean);
}

/** 处理 GET /__prd__/list-docs */
function listDocsHandler(req, res) {
  try {
    const docs = listDocs();
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: true, docs }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

/** 将用户输入规范化为英文项目名风格文件名（不含后缀） */
function toProjectLikeFileName(name) {
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

/** 处理 POST /__prd__/create-doc { name } */
function createDocHandler(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const { name } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!name || typeof name !== 'string') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'name required' }));
      }
      const slug = nextSlug();
      const docDir = path.join(PRD_PAGES_DIR, slug);
      fs.mkdirSync(docDir, { recursive: true });
      const safeName = toProjectLikeFileName(name);
      if (!safeName) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'name must contain english letters, numbers, dots, underscores or hyphens' }));
      }
      const mdFileName = `${safeName}.md`;
      const mdFilePath = path.join(docDir, mdFileName);
      const initMd = `<!-- block:h1 -->\n\n# ${safeName}\n`;
      fs.writeFileSync(mdFilePath, initMd, 'utf8');
      fs.writeFileSync(mdFileToMetaPath(mdFilePath), '{}', 'utf8');
      fs.writeFileSync(mdFileToAnnotationsPath(mdFilePath), '{}', 'utf8');
      writeActiveDocSlug(slug);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, slug, title: safeName, mdPath: `/pages/${slug}/${mdFileName}` }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

/** 处理 POST /__prd__/switch-doc { slug } */
function switchDocHandler(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const { slug } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!slug || typeof slug !== 'string') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'slug required' }));
      }
      if (!findDocMdFile(slug)) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: 'doc not found' }));
      }
      writeActiveDocSlug(slug);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, slug }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

/**
 * 处理 POST /__prd__/rename-doc { slug, newName }
 * 同时重命名 .md、.meta.json、.annotations.json 三个文件。
 */
function renameDocHandler(req, res) {
  const chunks = [];
  req.on('data', c => chunks.push(c));
  req.on('end', () => {
    try {
      const { slug, newName } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      if (!slug || typeof slug !== 'string' || !newName || typeof newName !== 'string') {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'slug and newName required' }));
      }
      const oldMdFile = findDocMdFile(slug);
      if (!oldMdFile) {
        res.statusCode = 404;
        return res.end(JSON.stringify({ ok: false, error: 'doc not found' }));
      }
      const safeNewName = toProjectLikeFileName(newName);
      if (!safeNewName) {
        res.statusCode = 400;
        return res.end(JSON.stringify({ ok: false, error: 'newName must contain english letters, numbers, dots, underscores or hyphens' }));
      }
      const docDir = path.join(PRD_PAGES_DIR, slug);
      const newMdFile = path.join(docDir, `${safeNewName}.md`);
      if (newMdFile !== oldMdFile && fs.existsSync(newMdFile)) {
        res.statusCode = 409;
        return res.end(JSON.stringify({ ok: false, error: 'filename already exists' }));
      }
      if (newMdFile !== oldMdFile) {
        fs.renameSync(oldMdFile, newMdFile);
        const oldMeta = mdFileToMetaPath(oldMdFile);
        const newMeta = mdFileToMetaPath(newMdFile);
        if (fs.existsSync(oldMeta)) fs.renameSync(oldMeta, newMeta);
        const oldAnnot = mdFileToAnnotationsPath(oldMdFile);
        const newAnnot = mdFileToAnnotationsPath(newMdFile);
        if (fs.existsSync(oldAnnot)) fs.renameSync(oldAnnot, newAnnot);
      }
      const title = mdFileToTitle(newMdFile);
      const fileName = path.basename(newMdFile);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, slug, newFileName: fileName, title, mdPath: `/pages/${slug}/${fileName}` }));
    } catch (e) {
      res.statusCode = 500;
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

/** 处理 GET /__prd__/active-doc — 返回当前激活 slug、实际 md 文件名及路径 */
function activeDocHandler(req, res) {
  try {
    const slug = readActiveDocSlug();
    const mdFile = findDocMdFile(slug);
    const fileName = mdFile ? path.basename(mdFile) : 'untitled.md';
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Cache-Control', 'no-store');
    res.end(JSON.stringify({ ok: true, slug, mdPath: `/pages/${slug}/${fileName}`, fileName }));
  } catch (e) {
    res.statusCode = 500;
    res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
  }
}

function safeImageFilename(name) {
  const base = path.basename(String(name));
  if (!/^[\w.-]+\.(png|jpe?g|gif|webp)$/i.test(base)) {
    return null;
  }
  if (base.includes('..')) {
    return null;
  }
  return base;
}

function writeJsonObject(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function prdSaveImageHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const json = JSON.parse(raw);
      const filename = json.filename || json.fileName;
      const dataBase64 = json.dataBase64 || json.base64;
      const safe = safeImageFilename(filename);
      if (!safe || !dataBase64 || typeof dataBase64 !== 'string') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid request' }));
        return;
      }
      const dir = path.join(__dirname, 'public', 'prd');
      fs.mkdirSync(dir, { recursive: true });
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length > 25 * 1024 * 1024) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'file too large' }));
        return;
      }
      fs.writeFileSync(path.join(dir, safe), buf);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      const url = `/prd/${safe}`;
      res.end(JSON.stringify({ ok: true, url, path: url }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

function prdDeleteImageHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const json = JSON.parse(raw);
      const urlPath = json.path || json.url;
      if (typeof urlPath !== 'string' || !urlPath.startsWith('/prd/')) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid path' }));
        return;
      }
      const base = path.basename(urlPath);
      const safe = safeImageFilename(base);
      if (!safe || `/prd/${safe}` !== urlPath.split('?')[0]) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid filename' }));
        return;
      }
      const dir = path.join(__dirname, 'public', 'prd');
      const fullPath = path.join(dir, safe);
      const resolvedFull = path.resolve(fullPath);
      const resolvedRoot = path.resolve(dir);
      if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'path escape' }));
        return;
      }
      if (fs.existsSync(fullPath)) {
        fs.unlinkSync(fullPath);
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

function saveAnnotationAssetHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const json = JSON.parse(raw);
      const filename = json.filename || json.fileName;
      const dataBase64 = json.dataBase64 || json.base64;
      const safe = safeImageFilename(filename);
      if (!safe || !dataBase64 || typeof dataBase64 !== 'string') {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid request' }));
        return;
      }
      fs.mkdirSync(PRD_ANNOTATION_ASSET_DIR, { recursive: true });
      const buf = Buffer.from(dataBase64, 'base64');
      if (buf.length > 25 * 1024 * 1024) {
        res.statusCode = 413;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'file too large' }));
        return;
      }
      fs.writeFileSync(path.join(PRD_ANNOTATION_ASSET_DIR, safe), buf);
      const url = `/prd/annotations/${safe}`;
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true, url, path: url }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

function deleteAnnotationAssetHandler(req, res) {
  const chunks = [];
  req.on('data', (c) => chunks.push(c));
  req.on('end', () => {
    try {
      const raw = Buffer.concat(chunks).toString('utf8');
      const json = JSON.parse(raw);
      const urlPath = json.path || json.url;
      if (typeof urlPath !== 'string' || !urlPath.startsWith('/prd/annotations/')) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid path' }));
        return;
      }
      const safe = safeImageFilename(path.basename(urlPath));
      if (!safe || `/prd/annotations/${safe}` !== urlPath.split('?')[0]) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'invalid filename' }));
        return;
      }
      const fullPath = path.join(PRD_ANNOTATION_ASSET_DIR, safe);
      const resolvedFull = path.resolve(fullPath);
      const resolvedRoot = path.resolve(PRD_ANNOTATION_ASSET_DIR);
      if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ ok: false, error: 'path escape' }));
        return;
      }
      if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: true }));
    } catch (e) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
    }
  });
}

function createPrdLiveSync() {
  const clients = new Set();
  const watchedFiles = new Map();
  let started = false;

  function broadcast(event) {
    const payload = `event: ${event.type}\ndata: ${JSON.stringify({
      ...event,
      ts: Date.now(),
    })}\n\n`;
    for (const client of clients) {
      try {
        client.write(payload);
      } catch {
        clients.delete(client);
        try { client.end(); } catch {}
      }
    }
  }

  function watchFile(filePath, event) {
    if (watchedFiles.has(filePath)) return;
    const listener = (curr, prev) => {
      const sameMtime = (curr?.mtimeMs || 0) === (prev?.mtimeMs || 0);
      const sameSize = (curr?.size || 0) === (prev?.size || 0);
      if (sameMtime && sameSize) return;
      broadcast(event);
    };
    fs.watchFile(filePath, { interval: 300 }, listener);
    watchedFiles.set(filePath, listener);
  }

  return {
    start() {
      if (started) return;
      started = true;
      const slug = readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      if (mdFile) watchFile(mdFile, { type: 'md-changed' });
    },
    stop() {
      for (const [filePath, listener] of watchedFiles) {
        fs.unwatchFile(filePath, listener);
      }
      watchedFiles.clear();
      for (const client of clients) {
        try { client.end(); } catch {}
      }
      clients.clear();
      started = false;
    },
    handleEvents(req, res) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Connection', 'keep-alive');
      res.write('retry: 1500\n');
      res.write(': connected\n\n');
      clients.add(res);
      req.on('close', () => {
        clients.delete(res);
        try { res.end(); } catch {}
      });
    },
  };
}

function attachMiddleware(server, liveSync) {
  const feishuSyncApi = createFeishuSyncApi({
    rootDir: __dirname,
    publicDir: path.join(__dirname, 'public'),
  });
  server.middlewares.use((req, res, next) => {
    const pathOnly = decodeURIComponent(String(req.url || '').split('?')[0]);

    // ── 多文档 API ──
    if (pathOnly === API_LIST_DOCS && req.method === 'GET') {
      listDocsHandler(req, res);
      return;
    }
    if (pathOnly === API_CREATE_DOC && req.method === 'POST') {
      createDocHandler(req, res);
      return;
    }
    if (pathOnly === API_SWITCH_DOC && req.method === 'POST') {
      switchDocHandler(req, res);
      return;
    }
    if (pathOnly === API_RENAME_DOC && req.method === 'POST') {
      renameDocHandler(req, res);
      return;
    }
    if (pathOnly === API_ACTIVE_DOC && req.method === 'GET') {
      activeDocHandler(req, res);
      return;
    }

    // GET /pages/:slug/*.md → 任意 slug 的 PRD 正文
    const mdMatch = pathOnly.match(/^\/pages\/([^/]+)\/(.+\.md)$/);
    if (mdMatch && req.method === 'GET') {
      const slug = mdMatch[1];
      const mdFile = findDocMdFile(slug);
      try {
        if (!mdFile) {
          res.statusCode = 404;
          return res.end('md file not found');
        }
        const content = fs.readFileSync(mdFile, 'utf8');
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      } catch (e) {
        res.statusCode = 500;
        res.end(String(e?.message || e));
      }
      return;
    }

    if (pathOnly === API_IMAGE && req.method === 'POST') {
      prdSaveImageHandler(req, res);
      return;
    }
    if (pathOnly === API_DELETE_IMAGE && req.method === 'POST') {
      prdDeleteImageHandler(req, res);
      return;
    }

    // POST /__prd__/save-md?slug=xxx
    if (pathOnly === API_MD && req.method === 'POST') {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      if (!mdFile) {
        res.statusCode = 404;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: 'md file not found for slug: ' + slug }));
      }
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { content } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof content !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'content must be string' }));
          }
          fs.mkdirSync(path.dirname(mdFile), { recursive: true });
          fs.writeFileSync(mdFile, content, 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
      return;
    }

    // GET /__prd__/meta?slug=xxx
    if (pathOnly === API_META && req.method === 'GET') {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      const metaFile = mdFile ? mdFileToMetaPath(mdFile) : path.join(PRD_PAGES_DIR, slug, 'meta.json');
      try {
        const content = fs.existsSync(metaFile) ? fs.readFileSync(metaFile, 'utf8') : '{}';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
      return;
    }

    // POST /__prd__/save-meta?slug=xxx
    if (pathOnly === API_SAVE_META && req.method === 'POST') {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      const metaFile = mdFile ? mdFileToMetaPath(mdFile) : path.join(PRD_PAGES_DIR, slug, 'meta.json');
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'meta must be a JSON object' }));
          }
          fs.mkdirSync(path.dirname(metaFile), { recursive: true });
          fs.writeFileSync(metaFile, JSON.stringify(parsed, null, 2), 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
      return;
    }

    // GET /__prd__/annotations?slug=xxx
    if (pathOnly === API_ANNOTATIONS && req.method === 'GET') {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      const annotFile = mdFile ? mdFileToAnnotationsPath(mdFile) : path.join(PRD_PAGES_DIR, slug, 'annotations.json');
      try {
        const content = fs.existsSync(annotFile) ? fs.readFileSync(annotFile, 'utf8') : '{}';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(content);
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
      return;
    }

    // POST /__prd__/save-annotations?slug=xxx
    if (pathOnly === API_SAVE_ANNOTATIONS && req.method === 'POST') {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug();
      const mdFile = findDocMdFile(slug);
      const annotFile = mdFile ? mdFileToAnnotationsPath(mdFile) : path.join(PRD_PAGES_DIR, slug, 'annotations.json');
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'annotations must be a JSON object' }));
          }
          writeJsonObject(annotFile, parsed);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
      return;
    }

    if (pathOnly === API_SAVE_ANNOTATION_ASSET && req.method === 'POST') {
      saveAnnotationAssetHandler(req, res);
      return;
    }
    if (pathOnly === API_DELETE_ANNOTATION_ASSET && req.method === 'POST') {
      deleteAnnotationAssetHandler(req, res);
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
  const liveSync = createPrdLiveSync();
  return {
    name: 'prd-save-image',
    configureServer(server) {
      liveSync.start();
      server.httpServer?.once('close', () => liveSync.stop());
      attachMiddleware(server, liveSync);
    },
    configurePreviewServer(server) {
      liveSync.start();
      server.httpServer?.once('close', () => liveSync.stop());
      attachMiddleware(server, liveSync);
    },
  };
}
