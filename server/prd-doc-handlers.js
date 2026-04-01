import { Buffer } from 'node:buffer';
import fs from 'fs';
import path from 'path';

// ─── 多文档辅助 ──────────────────────────────────────────────────────────────

/** 读取当前激活文档的 slug，默认 'doc-001' */
export function readActiveDocSlug(pagesDir, activeFile) {
  try {
    if (fs.existsSync(activeFile)) {
      const data = JSON.parse(fs.readFileSync(activeFile, 'utf8'));
      if (typeof data.slug === 'string' && data.slug) return data.slug;
    }
  } catch {}
  return 'doc-001';
}

/** 写入当前激活文档的 slug */
export function writeActiveDocSlug(pagesDir, activeFile, slug) {
  fs.mkdirSync(pagesDir, { recursive: true });
  fs.writeFileSync(activeFile, JSON.stringify({ slug }, null, 2), 'utf8');
}

/** 扫描 pages/ 目录，返回下一个可用的 doc-NNN slug */
function nextSlug(pagesDir) {
  let max = 0;
  if (fs.existsSync(pagesDir)) {
    for (const d of fs.readdirSync(pagesDir, { withFileTypes: true })) {
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
export function findDocMdFile(pagesDir, slug) {
  const docDir = path.join(pagesDir, slug);
  if (!fs.existsSync(docDir)) return null;
  const files = fs.readdirSync(docDir).filter(f => f.endsWith('.md'));
  if (files.length === 0) return null;
  return path.join(docDir, files[0]);
}

/** 从文件路径中提取展示用的 title（文件名去掉 .md 后缀） */
export function mdFileToTitle(mdFilePath) {
  return path.basename(mdFilePath, '.md');
}

/** 根据 .md 文件路径推导同目录下的 .meta.json 路径 */
export function mdFileToMetaPath(mdFilePath) {
  const dir = path.dirname(mdFilePath);
  const base = path.basename(mdFilePath, '.md');
  return path.join(dir, `${base}.meta.json`);
}

/** 根据 .md 文件路径推导同目录下的 .annotations.json 路径 */
export function mdFileToAnnotationsPath(mdFilePath) {
  const dir = path.dirname(mdFilePath);
  const base = path.basename(mdFilePath, '.md');
  return path.join(dir, `${base}.annotations.json`);
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

/** 列出所有 PRD 文档 */
function listDocs(pagesDir, activeFile) {
  const activeSlug = readActiveDocSlug(pagesDir, activeFile);
  if (!fs.existsSync(pagesDir)) return [];
  const dirs = fs.readdirSync(pagesDir, { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(d => d.name);

  return dirs
    .map(slug => {
      const mdFile = findDocMdFile(pagesDir, slug);
      if (!mdFile) return null;
      return { slug, title: mdFileToTitle(mdFile), active: slug === activeSlug };
    })
    .filter(Boolean);
}

// ─── Handler 工厂 ────────────────────────────────────────────────────────────

export function createDocHandlers({ pagesDir, activeFile }) {
  return {
    /** GET /__prd__/list-docs */
    listDocs(req, res) {
      try {
        const docs = listDocs(pagesDir, activeFile);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: true, docs }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    },

    /** POST /__prd__/create-doc { name } */
    createDoc(req, res) {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { name } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!name || typeof name !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'name required' }));
          }
          const slug = nextSlug(pagesDir);
          const docDir = path.join(pagesDir, slug);
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
          writeActiveDocSlug(pagesDir, activeFile, slug);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, slug, title: safeName, mdPath: `/pages/${slug}/${mdFileName}` }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /** POST /__prd__/switch-doc { slug } */
    switchDoc(req, res) {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { slug } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!slug || typeof slug !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'slug required' }));
          }
          if (!findDocMdFile(pagesDir, slug)) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ ok: false, error: 'doc not found' }));
          }
          writeActiveDocSlug(pagesDir, activeFile, slug);
          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, slug }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
        }
      });
    },

    /** POST /__prd__/rename-doc { slug, newName } */
    renameDoc(req, res) {
      const chunks = [];
      req.on('data', c => chunks.push(c));
      req.on('end', () => {
        try {
          const { slug, newName } = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          if (!slug || typeof slug !== 'string' || !newName || typeof newName !== 'string') {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'slug and newName required' }));
          }
          const oldMdFile = findDocMdFile(pagesDir, slug);
          if (!oldMdFile) {
            res.statusCode = 404;
            return res.end(JSON.stringify({ ok: false, error: 'doc not found' }));
          }
          const safeNewName = toProjectLikeFileName(newName);
          if (!safeNewName) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ ok: false, error: 'newName must contain english letters, numbers, dots, underscores or hyphens' }));
          }
          const docDir = path.join(pagesDir, slug);
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
    },

    /** GET /__prd__/active-doc */
    activeDoc(req, res) {
      try {
        const slug = readActiveDocSlug(pagesDir, activeFile);
        const mdFile = findDocMdFile(pagesDir, slug);
        const fileName = mdFile ? path.basename(mdFile) : 'untitled.md';
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'no-store');
        res.end(JSON.stringify({ ok: true, slug, mdPath: `/pages/${slug}/${fileName}`, fileName }));
      } catch (e) {
        res.statusCode = 500;
        res.end(JSON.stringify({ ok: false, error: String(e?.message || e) }));
      }
    },
  };
}
