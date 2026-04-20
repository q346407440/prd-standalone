import { Buffer } from 'node:buffer';
import { spawn } from 'node:child_process';
import fs from 'fs';
import path from 'path';

/**
 * 跑一条 git 命令，返回 { code, stdout, stderr }。
 * 子进程继承父进程 env（含 SSH_AUTH_SOCK），让 ssh-agent 里的 key 可用。
 */
function runGit(args, cwd) {
  return new Promise((resolve) => {
    const child = spawn('git', args, { cwd, env: process.env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (c) => { stdout += c.toString('utf8'); });
    child.stderr.on('data', (c) => { stderr += c.toString('utf8'); });
    child.on('error', (err) => resolve({ code: -1, stdout, stderr: stderr || String(err?.message || err) }));
    child.on('close', (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

/** git add 一次命令行参数有长度限制，按批拆开执行 */
async function gitAddPathsInBatches(cwd, absPaths, batchSize = 100) {
  for (let i = 0; i < absPaths.length; i += batchSize) {
    const slice = absPaths.slice(i, i + batchSize);
    const result = await runGit(['add', '-A', '--', ...slice], cwd);
    if (result.code !== 0) {
      return { ok: false, stderr: result.stderr || result.stdout };
    }
  }
  return { ok: true };
}

function toRepoRelativePath(repoRoot, absPath) {
  return path.relative(repoRoot, absPath).split(path.sep).join('/');
}

function uniqueNonEmpty(items) {
  return Array.from(new Set(items.filter(Boolean)));
}
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

    /**
     * POST /__prd__/sync-native-md
     * 把「导出原生 MD」的解压后内容镜像写入用户指定的本地 Git 工作区子目录。
     * 入参（JSON）：
     *   - targetDir: 绝对路径，工作区根目录（必须已存在且是目录）
     *   - folderName: 子目录名（仅允许普通目录名，禁止路径穿越）
     *   - entries: [{ relPath, contentBase64 }]（相对子目录的路径；.md 与 assets/ 文件都在这里）
     * 镜像策略：写入/覆盖 entries 中的所有文件，并删除该子目录中不在 entries 中的历史文件，
     * 触发 SourceTree 的新增（A）/ 修改（M）/ 删除（D）状态。
     */
    syncNativeMd(req, res) {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', async () => {
        try {
          const raw = Buffer.concat(chunks).toString('utf8');
          const payload = JSON.parse(raw);
          const targetDir = typeof payload.targetDir === 'string' ? payload.targetDir.trim() : '';
          const folderName = typeof payload.folderName === 'string' ? payload.folderName.trim() : '';
          const entries = Array.isArray(payload.entries) ? payload.entries : null;
          const mode = typeof payload.mode === 'string' ? payload.mode : 'files-only';
          const commitMessage = typeof payload.commitMessage === 'string' ? payload.commitMessage.trim() : '';
          const wantCommit = mode === 'commit' || mode === 'commit-and-push';
          const wantPush = mode === 'commit-and-push';
          if (wantCommit && !commitMessage) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: 'commit 模式下 commitMessage 不能为空' }));
          }

          if (!targetDir || !path.isAbsolute(targetDir)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: '目标目录必须是绝对路径' }));
          }
          if (!folderName) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: '子文件夹名称不能为空' }));
          }
          // 子目录名：禁止路径分隔、相对跳转与空白；只允许普通目录名
          if (/[\\/]/.test(folderName) || folderName === '.' || folderName === '..' || /^\s|\s$/.test(folderName)) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: '子文件夹名称非法' }));
          }
          if (!entries || entries.length === 0) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: '没有可同步的文件' }));
          }

          const resolvedTarget = path.resolve(targetDir);
          if (!fs.existsSync(resolvedTarget) || !fs.statSync(resolvedTarget).isDirectory()) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: `目标目录不存在或不是目录：${resolvedTarget}` }));
          }

          const syncRoot = path.resolve(resolvedTarget, folderName);
          if (!syncRoot.startsWith(resolvedTarget + path.sep) && syncRoot !== resolvedTarget) {
            res.statusCode = 400;
            res.setHeader('Content-Type', 'application/json; charset=utf-8');
            return res.end(JSON.stringify({ ok: false, error: '子文件夹路径穿越到目标目录之外' }));
          }

          // 收集本次期望写入的相对路径（POSIX 风格，便于比对），同时校验每项 relPath
          const expectedRelSet = new Set();
          const normalizedEntries = [];
          for (const entry of entries) {
            const relPath = typeof entry?.relPath === 'string' ? entry.relPath : '';
            const contentBase64 = typeof entry?.contentBase64 === 'string' ? entry.contentBase64 : '';
            if (!relPath) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ ok: false, error: '存在非法的文件条目（缺少 relPath）' }));
            }
            if (relPath.startsWith('/') || relPath.startsWith('\\') || relPath.includes('..')) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ ok: false, error: `非法相对路径：${relPath}` }));
            }
            const absPath = path.resolve(syncRoot, relPath);
            if (!absPath.startsWith(syncRoot + path.sep) && absPath !== syncRoot) {
              res.statusCode = 400;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({ ok: false, error: `路径穿越：${relPath}` }));
            }
            const posixRel = relPath.split(path.sep).join('/');
            expectedRelSet.add(posixRel);
            normalizedEntries.push({ relPath: posixRel, absPath, contentBase64 });
          }

          // 收集目标子目录下已有的所有文件（递归），以便镜像对齐（删除本次不再需要的文件）
          const existingRelPaths = new Set();
          if (fs.existsSync(syncRoot) && fs.statSync(syncRoot).isDirectory()) {
            const walk = (dir) => {
              for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
                const full = path.join(dir, entry.name);
                if (entry.isDirectory()) { walk(full); continue; }
                if (!entry.isFile()) continue;
                const rel = path.relative(syncRoot, full).split(path.sep).join('/');
                existingRelPaths.add(rel);
              }
            };
            walk(syncRoot);
          } else {
            fs.mkdirSync(syncRoot, { recursive: true });
          }

          // 写入/覆盖 entries
          let writtenCount = 0;
          for (const { absPath, contentBase64 } of normalizedEntries) {
            fs.mkdirSync(path.dirname(absPath), { recursive: true });
            const buf = Buffer.from(contentBase64 || '', 'base64');
            fs.writeFileSync(absPath, buf);
            writtenCount += 1;
          }

          // 删除旧文件（本次 entries 中不存在的）
          const deletedPaths = [];
          for (const rel of existingRelPaths) {
            if (expectedRelSet.has(rel)) continue;
            const absPath = path.resolve(syncRoot, rel);
            if (!absPath.startsWith(syncRoot + path.sep)) continue;
            try {
              if (fs.existsSync(absPath)) fs.unlinkSync(absPath);
              deletedPaths.push(rel);
            } catch { /* ignore */ }
          }

          // 清理空目录（自底向上）
          const removeEmptyDirs = (dir) => {
            if (dir === syncRoot) return;
            if (!fs.existsSync(dir)) return;
            try {
              const names = fs.readdirSync(dir);
              if (names.length === 0) {
                fs.rmdirSync(dir);
                removeEmptyDirs(path.dirname(dir));
              }
            } catch { /* ignore */ }
          };
          for (const rel of deletedPaths) {
            removeEmptyDirs(path.dirname(path.resolve(syncRoot, rel)));
          }

          const gitResult = { attempted: wantCommit, committed: false, pushed: false };

          if (wantCommit) {
            // 1) 校验 syncRoot 在 git 工作区里
            const topLevel = await runGit(['rev-parse', '--show-toplevel'], syncRoot);
            if (topLevel.code !== 0) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({
                ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                git: {
                  ...gitResult,
                  error: `目标目录不是 git 工作区：${topLevel.stderr.trim() || '请先在 SourceTree 或命令行中 clone / init 该仓库'}`,
                },
              }));
            }
            const repoRoot = topLevel.stdout.trim();

            // 2) 校验 git 身份
            const uname = await runGit(['config', 'user.name'], repoRoot);
            const uemail = await runGit(['config', 'user.email'], repoRoot);
            if (!uname.stdout.trim() || !uemail.stdout.trim()) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({
                ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                git: {
                  ...gitResult,
                  error: '尚未配置 git 身份，请先跑：git config --global user.name "你的名字" && git config --global user.email "you@example.com"',
                },
              }));
            }

            // 3) 只 add 本次写入/删除的具体路径（包含增/改/删）
            const pathsToAdd = [
              ...normalizedEntries.map((e) => e.absPath),
              ...deletedPaths.map((rel) => path.resolve(syncRoot, rel)),
            ];
            const repoRelPaths = uniqueNonEmpty(pathsToAdd.map((p) => toRepoRelativePath(repoRoot, p)));

            // 若仓库里本来就有其他已暂存改动，拒绝继续，避免把用户手工暂存的内容误提交进去。
            const stagedBeforeRes = await runGit(['diff', '--cached', '--name-only'], repoRoot);
            const stagedBeforePaths = uniqueNonEmpty(
              (stagedBeforeRes.stdout || '').split('\n').map((s) => s.trim()),
            );
            const foreignStagedPaths = stagedBeforePaths.filter((p) => !repoRelPaths.includes(p));
            if (foreignStagedPaths.length > 0) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({
                ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                git: {
                  ...gitResult,
                  error: `仓库里已有其他暂存改动，已阻止自动 commit：${foreignStagedPaths.join(', ')}`,
                },
              }));
            }

            if (repoRelPaths.length) {
              const addRes = await gitAddPathsInBatches(repoRoot, repoRelPaths);
              if (!addRes.ok) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify({
                  ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                  writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                  git: { ...gitResult, error: `git add 失败：${addRes.stderr}` },
                }));
              }
            }

            // 4) 检查本次涉及的路径到底有没有实质变更（避免空 commit 报错）
            const diffRes = await runGit(
              ['diff', '--cached', '--quiet', '--', ...repoRelPaths],
              repoRoot,
            );
            const hasStagedChange = diffRes.code === 1;
            if (!hasStagedChange) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({
                ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                git: { ...gitResult, skipped: 'no-change', message: '文件与仓库完全一致，无需 commit' },
              }));
            }

            // 5) commit
            const commitRes = await runGit(['commit', '-m', commitMessage], repoRoot);
            if (commitRes.code !== 0) {
              res.statusCode = 200;
              res.setHeader('Content-Type', 'application/json; charset=utf-8');
              return res.end(JSON.stringify({
                ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                git: { ...gitResult, error: `git commit 失败：${commitRes.stderr || commitRes.stdout}` },
              }));
            }
            gitResult.committed = true;
            const hashRes = await runGit(['rev-parse', '--short', 'HEAD'], repoRoot);
            if (hashRes.code === 0) gitResult.commitHash = hashRes.stdout.trim();

            // 6) push（可选）
            if (wantPush) {
              gitResult.attempted = 'commit-and-push';
              const branchRes = await runGit(['rev-parse', '--abbrev-ref', 'HEAD'], repoRoot);
              const branch = branchRes.stdout.trim();
              const upstreamRes = await runGit(
                ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'],
                repoRoot,
              );
              const hasUpstream = upstreamRes.code === 0;
              const pushArgs = hasUpstream ? ['push'] : ['push', '-u', 'origin', branch];
              const pushRes = await runGit(pushArgs, repoRoot);
              if (pushRes.code !== 0) {
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json; charset=utf-8');
                return res.end(JSON.stringify({
                  ok: true, targetDir: resolvedTarget, folderName, syncRoot,
                  writtenCount, deletedCount: deletedPaths.length, deletedPaths,
                  git: {
                    ...gitResult,
                    error: `commit 成功（${gitResult.commitHash || ''}），但 git push 失败：${pushRes.stderr || pushRes.stdout}。请到 SourceTree 里 pull / 解决冲突后重推。`,
                  },
                }));
              }
              gitResult.pushed = true;
              gitResult.branch = branch;
            }
          }

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({
            ok: true,
            targetDir: resolvedTarget,
            folderName,
            syncRoot,
            writtenCount,
            deletedCount: deletedPaths.length,
            deletedPaths,
            git: gitResult,
          }));
        } catch (e) {
          res.statusCode = 500;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
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
