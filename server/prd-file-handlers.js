import { Buffer } from 'node:buffer';
import fs from 'fs';
import path from 'path';
import {
  readActiveDocSlug,
  findDocMdFile,
  mdFileToMetaPath,
  mdFileToAnnotationsPath,
} from './prd-doc-handlers.js';

function safeImageFilename(name) {
  const base = path.basename(String(name));
  if (!/^[\w.-]+\.(png|jpe?g|gif|webp)$/i.test(base)) return null;
  if (base.includes('..')) return null;
  return base;
}

function writeJsonObject(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

/** 仅允许 doc-001 形式，防止路径穿越 */
function isSafeDocSlug(slug) {
  return typeof slug === 'string' && /^doc-\d+$/.test(slug);
}

/** 三槽轮替：pages-backup/<slug>/s0、s1、s2，定时备份覆盖最旧槽；元数据 .backup-rotate.json */
const PRD_BACKUP_SLOTS = ['s0', 's1', 's2'];
const PRD_BACKUP_ROTATE_META = '.backup-rotate.json';

function prdBackupSlotDir(backupRootForSlug, index) {
  return path.join(backupRootForSlug, PRD_BACKUP_SLOTS[index]);
}

function prdBackupSlotHasContent(slotDir) {
  if (!fs.existsSync(slotDir)) return false;
  try {
    if (!fs.statSync(slotDir).isDirectory()) return false;
  } catch {
    return false;
  }
  const names = fs.readdirSync(slotDir).filter((n) => n !== '.DS_Store');
  return names.length > 0;
}

function prdSafeDirMtimeMs(dir) {
  try {
    return fs.statSync(dir).mtimeMs;
  } catch {
    return 0;
  }
}

function prdReadBackupRotateMeta(backupRootForSlug) {
  const fp = path.join(backupRootForSlug, PRD_BACKUP_ROTATE_META);
  const at = Array.from({ length: PRD_BACKUP_SLOTS.length }, () => null);
  try {
    if (fs.existsSync(fp)) {
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (Array.isArray(j.at)) {
        for (let i = 0; i < PRD_BACKUP_SLOTS.length; i += 1) {
          if (j.at[i]) {
            const t = Date.parse(j.at[i]);
            if (!Number.isNaN(t)) at[i] = t;
          }
        }
      }
    }
  } catch (_) { /* ignore */ }
  for (let i = 0; i < PRD_BACKUP_SLOTS.length; i += 1) {
    const slotDir = prdBackupSlotDir(backupRootForSlug, i);
    if (at[i] == null && prdBackupSlotHasContent(slotDir)) at[i] = prdSafeDirMtimeMs(slotDir);
  }
  return at;
}

function prdWriteBackupRotateMeta(backupRootForSlug, atList) {
  const iso = PRD_BACKUP_SLOTS.map((_, i) => {
    const t = atList[i];
    return t == null || Number.isNaN(t) ? null : new Date(t).toISOString();
  });
  fs.mkdirSync(backupRootForSlug, { recursive: true });
  fs.writeFileSync(
    path.join(backupRootForSlug, PRD_BACKUP_ROTATE_META),
    JSON.stringify({ at: iso, version: 2 }, null, 2),
    'utf8',
  );
}

/** 旧版扁平目录（md 等在 pages-backup/<slug>/ 根下）迁入 s0 */
function prdMigrateLegacyFlatBackup(backupRootForSlug) {
  if (!fs.existsSync(backupRootForSlug) || !fs.statSync(backupRootForSlug).isDirectory()) return;
  if (PRD_BACKUP_SLOTS.some((_, i) => prdBackupSlotHasContent(prdBackupSlotDir(backupRootForSlug, i)))) {
    return;
  }
  let entries;
  try {
    entries = fs.readdirSync(backupRootForSlug, { withFileTypes: true });
  } catch {
    return;
  }
  const movable = entries.filter(
    (e) => e.name !== PRD_BACKUP_ROTATE_META
      && e.name !== '.DS_Store'
      && !PRD_BACKUP_SLOTS.includes(e.name),
  );
  if (movable.length === 0) return;
  const s0 = prdBackupSlotDir(backupRootForSlug, 0);
  fs.mkdirSync(s0, { recursive: true });
  for (const e of movable) {
    fs.renameSync(
      path.join(backupRootForSlug, e.name),
      path.join(s0, e.name),
    );
  }
  const nextAt = Array.from({ length: PRD_BACKUP_SLOTS.length }, () => null);
  nextAt[0] = Date.now();
  prdWriteBackupRotateMeta(backupRootForSlug, nextAt);
}

function prdPickBackupSlotIndex(backupRootForSlug) {
  for (let i = 0; i < PRD_BACKUP_SLOTS.length; i += 1) {
    if (!prdBackupSlotHasContent(prdBackupSlotDir(backupRootForSlug, i))) return i;
  }
  const at = prdReadBackupRotateMeta(backupRootForSlug);
  let oldestIndex = 0;
  let oldestAt = at[0] ?? 0;
  for (let i = 1; i < PRD_BACKUP_SLOTS.length; i += 1) {
    const currentAt = at[i] ?? 0;
    if (currentAt < oldestAt) {
      oldestAt = currentAt;
      oldestIndex = i;
    }
  }
  return oldestIndex;
}

function prdBuildBackupSlotsPayload(backupRootForSlug) {
  prdMigrateLegacyFlatBackup(backupRootForSlug);
  return PRD_BACKUP_SLOTS.map((_, i) => {
    const p = prdBackupSlotDir(backupRootForSlug, i);
    return {
      index: i,
      name: PRD_BACKUP_SLOTS[i],
      path: path.resolve(p),
      exists: prdBackupSlotHasContent(p),
    };
  });
}

// ─── Handler 工厂 ────────────────────────────────────────────────────────────

export function createFileHandlers({ rootDir, pagesDir, activeFile, annotationAssetDir }) {
  const publicPrdDir = path.join(rootDir, 'public', 'prd');
  const pagesBackupRoot = path.join(rootDir, 'pages-backup');

  /** 解析 doc 资产目录，对 slug 做安全校验 */
  function docAssetsDir(slug) {
    if (!isSafeDocSlug(slug)) return null;
    const dir = path.join(pagesDir, slug, 'assets');
    const resolvedDir = path.resolve(dir);
    const resolvedPages = path.resolve(pagesDir);
    if (!resolvedDir.startsWith(resolvedPages + path.sep)) return null;
    return resolvedDir;
  }

  /**
   * 把客户端传来的图片路径解析为磁盘路径。
   * 兼容三种格式：
   *   1) /pages/<slug>/assets/<file>      新格式（浏览器加载用的 URL）
   *   2) ./assets/<file>                  新格式（MD 源里写的相对路径）
   *   3) /prd/<file>                      旧格式（迁移期兼容）
   */
  function resolveImagePathOnDisk(urlPath, slug) {
    if (typeof urlPath !== 'string') return null;
    const cleaned = urlPath.split('?')[0].split('#')[0];

    const pagesMatch = cleaned.match(/^\/pages\/(doc-\d+)\/assets\/([^/]+)$/);
    if (pagesMatch) {
      const [, pathSlug, base] = pagesMatch;
      const safe = safeImageFilename(base);
      if (!safe) return null;
      const dir = docAssetsDir(pathSlug);
      if (!dir) return null;
      return { kind: 'doc', slug: pathSlug, dir, file: safe };
    }

    if (cleaned.startsWith('./assets/') || cleaned.startsWith('assets/')) {
      const base = cleaned.replace(/^\.?\//, '').slice('assets/'.length);
      const safe = safeImageFilename(base);
      if (!safe) return null;
      const dir = docAssetsDir(slug);
      if (!dir) return null;
      return { kind: 'doc', slug, dir, file: safe };
    }

    if (cleaned.startsWith('/prd/') && !cleaned.startsWith('/prd/annotations/')) {
      const base = cleaned.slice('/prd/'.length);
      const safe = safeImageFilename(base);
      if (!safe) return null;
      return { kind: 'legacy', slug: null, dir: publicPrdDir, file: safe };
    }

    return null;
  }

  return {
    /** POST /__prd__/save-image?slug=doc-001 — 写到 pages/<slug>/assets/，返回 ./assets/<file> */
    saveImage(req, res) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const assetsDir = docAssetsDir(slug);
      if (!assetsDir) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ ok: false, error: `invalid slug: ${slug}` }));
      }
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
          const buf = Buffer.from(dataBase64, 'base64');
          if (buf.length > 25 * 1024 * 1024) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'file too large' }));
            return;
          }
          fs.mkdirSync(assetsDir, { recursive: true });
          fs.writeFileSync(path.join(assetsDir, safe), buf);
          // MD 里写相对路径；URL 是浏览器加载用的（与 Vite 中间件路由一致）
          const mdPath = `./assets/${safe}`;
          const url = `/pages/${slug}/assets/${safe}`;
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, url, path: mdPath, slug }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /**
     * POST /__prd__/delete-image?slug=doc-001
     * 兼容三种 path 格式：./assets/x、/pages/<slug>/assets/x、/prd/x（迁移期）
     */
    deleteImage(req, res) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const json = JSON.parse(raw);
          const urlPath = json.path || json.url;
          const resolved = resolveImagePathOnDisk(urlPath, slug);
          if (!resolved) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'invalid path' }));
            return;
          }
          const fullPath = path.join(resolved.dir, resolved.file);
          const resolvedFull = path.resolve(fullPath);
          const resolvedRoot = path.resolve(resolved.dir);
          if (!resolvedFull.startsWith(resolvedRoot + path.sep) && resolvedFull !== resolvedRoot) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'path escape' }));
            return;
          }
          if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, kind: resolved.kind }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /** GET /pages/:slug/assets/:file — 服务 doc 自带的图片（colocated） */
    readDocAsset(req, res, slug, fileName) {
      const safe = safeImageFilename(fileName);
      const assetsDir = docAssetsDir(slug);
      if (!safe || !assetsDir) {
        res.statusCode = 404;
        return res.end('not found');
      }
      const fullPath = path.join(assetsDir, safe);
      const resolvedFull = path.resolve(fullPath);
      const resolvedRoot = path.resolve(assetsDir);
      if (!resolvedFull.startsWith(resolvedRoot + path.sep)) {
        res.statusCode = 400;
        return res.end('path escape');
      }
      if (!fs.existsSync(resolvedFull) || !fs.statSync(resolvedFull).isFile()) {
        res.statusCode = 404;
        return res.end('not found');
      }
      const ext = path.extname(safe).toLowerCase();
      const mime = ext === '.png' ? 'image/png'
        : ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg'
        : ext === '.gif' ? 'image/gif'
        : ext === '.webp' ? 'image/webp'
        : ext === '.svg' ? 'image/svg+xml'
        : 'application/octet-stream';
      res.statusCode = 200;
      res.setHeader('Content-Type', mime);
      res.setHeader('Cache-Control', 'no-store');
      fs.createReadStream(resolvedFull).pipe(res);
    },

    /** POST /__prd__/save-md?slug=xxx */
    saveMd(req, res, { liveSync } = {}) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const mdFile = findDocMdFile(pagesDir, slug);
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
          liveSync?.suppressFileChange?.(mdFile);
          fs.writeFileSync(mdFile, content, 'utf8');
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /** GET /__prd__/meta?slug=xxx */
    getMeta(req, res) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const mdFile = findDocMdFile(pagesDir, slug);
      const metaFile = mdFile ? mdFileToMetaPath(mdFile) : path.join(pagesDir, slug, 'meta.json');
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
    },

    /** POST /__prd__/save-meta?slug=xxx */
    saveMeta(req, res) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const mdFile = findDocMdFile(pagesDir, slug);
      const metaFile = mdFile ? mdFileToMetaPath(mdFile) : path.join(pagesDir, slug, 'meta.json');
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
    },

    /** GET /__prd__/annotations?slug=xxx */
    getAnnotations(req, res) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const mdFile = findDocMdFile(pagesDir, slug);
      const annotFile = mdFile ? mdFileToAnnotationsPath(mdFile) : path.join(pagesDir, slug, 'annotations.json');
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
    },

    /** POST /__prd__/save-annotations?slug=xxx */
    saveAnnotations(req, res, { liveSync } = {}) {
      const urlObj = new URL(req.url, 'http://localhost');
      const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
      const mdFile = findDocMdFile(pagesDir, slug);
      const annotFile = mdFile ? mdFileToAnnotationsPath(mdFile) : path.join(pagesDir, slug, 'annotations.json');
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'annotations must be a JSON object' }));
          }
          liveSync?.suppressFileChange?.(annotFile);
          writeJsonObject(annotFile, parsed);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /** POST /__prd__/save-annotation-asset */
    saveAnnotationAsset(req, res) {
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
          fs.mkdirSync(annotationAssetDir, { recursive: true });
          const buf = Buffer.from(dataBase64, 'base64');
          if (buf.length > 25 * 1024 * 1024) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'file too large' }));
            return;
          }
          fs.writeFileSync(path.join(annotationAssetDir, safe), buf);
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
    },

    /** POST /__prd__/delete-annotation-asset */
    deleteAnnotationAsset(req, res) {
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
          const fullPath = path.join(annotationAssetDir, safe);
          const resolvedFull = path.resolve(fullPath);
          const resolvedRoot = path.resolve(annotationAssetDir);
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
    },

    /**
     * POST /__prd__/backup-doc?slug=doc-001
     * 将 pages/<slug>/ 镜像到 pages-backup/<slug>/s0|s1|s2（三槽轮替：优先补空槽，三槽都有后覆盖最旧）
     * 只备三件套等文本文件，**跳过 assets/ 子目录**——素材是实体图，出错不会丢失，无需冗余备份占盘。
     */
    backupDoc(req, res) {
      try {
        const urlObj = new URL(req.url, 'http://localhost');
        const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
        if (!isSafeDocSlug(slug)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'invalid slug' }));
        }
        const src = path.join(pagesDir, slug);
        const resolvedSrc = path.resolve(src);
        const resolvedPages = path.resolve(pagesDir);
        if (!resolvedSrc.startsWith(resolvedPages + path.sep) && resolvedSrc !== resolvedPages) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'path escape' }));
        }
        if (!fs.existsSync(resolvedSrc) || !fs.statSync(resolvedSrc).isDirectory()) {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'doc folder not found' }));
        }
        const destParent = path.join(pagesBackupRoot, slug);
        const resolvedDestParent = path.resolve(destParent);
        const resolvedBackupRoot = path.resolve(pagesBackupRoot);
        if (!resolvedDestParent.startsWith(resolvedBackupRoot + path.sep) && resolvedDestParent !== resolvedBackupRoot) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'backup path escape' }));
        }
        fs.mkdirSync(resolvedBackupRoot, { recursive: true });
        fs.mkdirSync(resolvedDestParent, { recursive: true });
        prdMigrateLegacyFlatBackup(resolvedDestParent);
        const beforeMeta = prdReadBackupRotateMeta(resolvedDestParent);
        const slotIndex = prdPickBackupSlotIndex(resolvedDestParent);
        const slotPath = prdBackupSlotDir(resolvedDestParent, slotIndex);
        const resolvedSlot = path.resolve(slotPath);
        if (!resolvedSlot.startsWith(resolvedDestParent + path.sep) && resolvedSlot !== resolvedDestParent) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'backup slot path escape' }));
        }
        fs.rmSync(resolvedSlot, { recursive: true, force: true });
        const assetsDirToSkip = path.join(resolvedSrc, 'assets');
        fs.cpSync(resolvedSrc, resolvedSlot, {
          recursive: true,
          filter: (srcPath) => {
            if (srcPath === assetsDirToSkip) return false;
            if (srcPath.startsWith(assetsDirToSkip + path.sep)) return false;
            return true;
          },
        });
        const nextAt = beforeMeta.slice(0, PRD_BACKUP_SLOTS.length);
        nextAt[slotIndex] = Date.now();
        prdWriteBackupRotateMeta(resolvedDestParent, nextAt);
        const at = new Date();
        const slotsPayload = prdBuildBackupSlotsPayload(resolvedDestParent);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          slug,
          at: at.toISOString(),
          atLocal: at.toLocaleString('zh-CN', { hour12: false }),
          backupDir: resolvedDestParent,
          backupSlot: slotIndex,
          backupSlotDir: resolvedSlot,
          slots: slotsPayload,
        }));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    },

    /**
     * GET /__prd__/backup-doc?slug=doc-001
     * 返回 pages-backup/<slug>/ 根路径及 s0、s1、s2 槽位信息（不执行拷贝）
     */
    getBackupDocDir(req, res) {
      try {
        const urlObj = new URL(req.url, 'http://localhost');
        const slug = urlObj.searchParams.get('slug') || readActiveDocSlug(pagesDir, activeFile);
        if (!isSafeDocSlug(slug)) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'invalid slug' }));
        }
        const dest = path.join(pagesBackupRoot, slug);
        const resolvedDest = path.resolve(dest);
        const resolvedBackupRoot = path.resolve(pagesBackupRoot);
        if (!resolvedDest.startsWith(resolvedBackupRoot + path.sep) && resolvedDest !== resolvedBackupRoot) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          return res.end(JSON.stringify({ ok: false, error: 'backup path escape' }));
        }
        const slots = prdBuildBackupSlotsPayload(resolvedDest);
        const backupExists = slots.some((s) => s.exists);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({
          ok: true,
          slug,
          backupDir: resolvedDest,
          backupExists,
          slots,
        }));
      } catch (e) {
        res.statusCode = 500;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    },

    /** GET /pages/:slug/*.md → 读取任意 slug 的 PRD 正文 */
    readMd(req, res, slug) {
      const mdFile = findDocMdFile(pagesDir, slug);
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
    },
  };
}
