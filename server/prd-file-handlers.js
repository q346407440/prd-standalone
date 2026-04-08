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

/** 双槽轮替：pages-backup/<slug>/s0、s1，定时备份覆盖较旧槽；元数据 .backup-rotate.json */
const PRD_BACKUP_SLOTS = ['s0', 's1'];
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
  let at0 = null;
  let at1 = null;
  try {
    if (fs.existsSync(fp)) {
      const j = JSON.parse(fs.readFileSync(fp, 'utf8'));
      if (Array.isArray(j.at) && j.at.length >= 2) {
        if (j.at[0]) {
          const t = Date.parse(j.at[0]);
          if (!Number.isNaN(t)) at0 = t;
        }
        if (j.at[1]) {
          const t = Date.parse(j.at[1]);
          if (!Number.isNaN(t)) at1 = t;
        }
      }
    }
  } catch (_) { /* ignore */ }
  const s0 = prdBackupSlotDir(backupRootForSlug, 0);
  const s1 = prdBackupSlotDir(backupRootForSlug, 1);
  if (at0 == null && prdBackupSlotHasContent(s0)) at0 = prdSafeDirMtimeMs(s0);
  if (at1 == null && prdBackupSlotHasContent(s1)) at1 = prdSafeDirMtimeMs(s1);
  return [at0, at1];
}

function prdWriteBackupRotateMeta(backupRootForSlug, at0, at1) {
  const iso = [
    at0 == null || Number.isNaN(at0) ? null : new Date(at0).toISOString(),
    at1 == null || Number.isNaN(at1) ? null : new Date(at1).toISOString(),
  ];
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
  if (prdBackupSlotHasContent(prdBackupSlotDir(backupRootForSlug, 0))
      || prdBackupSlotHasContent(prdBackupSlotDir(backupRootForSlug, 1))) {
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
      && e.name !== 's0'
      && e.name !== 's1',
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
  prdWriteBackupRotateMeta(backupRootForSlug, Date.now(), null);
}

function prdPickBackupSlotIndex(backupRootForSlug) {
  const s0 = prdBackupSlotDir(backupRootForSlug, 0);
  const s1 = prdBackupSlotDir(backupRootForSlug, 1);
  const ex0 = prdBackupSlotHasContent(s0);
  const ex1 = prdBackupSlotHasContent(s1);
  if (!ex0 && !ex1) return 0;
  if (ex0 && !ex1) return 1;
  if (!ex0 && ex1) return 0;
  const [t0, t1] = prdReadBackupRotateMeta(backupRootForSlug);
  const a = t0 ?? 0;
  const b = t1 ?? 0;
  return a <= b ? 0 : 1;
}

function prdBuildBackupSlotsPayload(backupRootForSlug) {
  prdMigrateLegacyFlatBackup(backupRootForSlug);
  return [0, 1].map((i) => {
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

  return {
    /** POST /__prd__/save-image */
    saveImage(req, res) {
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
          fs.mkdirSync(publicPrdDir, { recursive: true });
          const buf = Buffer.from(dataBase64, 'base64');
          if (buf.length > 25 * 1024 * 1024) {
            res.statusCode = 413;
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify({ ok: false, error: 'file too large' }));
            return;
          }
          fs.writeFileSync(path.join(publicPrdDir, safe), buf);
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
    },

    /** POST /__prd__/delete-image */
    deleteImage(req, res) {
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
          const fullPath = path.join(publicPrdDir, safe);
          const resolvedFull = path.resolve(fullPath);
          const resolvedRoot = path.resolve(publicPrdDir);
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
     * 将 pages/<slug>/ 镜像到 pages-backup/<slug>/s0|s1（双槽轮替：先填 s0 再 s1，两槽皆有则覆盖较旧）
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
        fs.cpSync(resolvedSrc, resolvedSlot, { recursive: true });
        const nextAt = [beforeMeta[0], beforeMeta[1]];
        nextAt[slotIndex] = Date.now();
        prdWriteBackupRotateMeta(resolvedDestParent, nextAt[0], nextAt[1]);
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
     * 返回 pages-backup/<slug>/ 根路径及 s0、s1 槽位信息（不执行拷贝）
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
