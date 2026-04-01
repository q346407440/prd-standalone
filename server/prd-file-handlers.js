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

// ─── Handler 工厂 ────────────────────────────────────────────────────────────

export function createFileHandlers({ rootDir, pagesDir, activeFile, annotationAssetDir }) {
  const publicPrdDir = path.join(rootDir, 'public', 'prd');

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
    saveAnnotations(req, res) {
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
