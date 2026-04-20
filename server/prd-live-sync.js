import fs from 'fs';
import path from 'path';
import { readActiveDocSlug, findDocMdFile, mdFileToAnnotationsPath } from './prd-doc-handlers.js';

export function createPrdLiveSync({ pagesDir, activeFile, publicPrdDir }) {
  const clients = new Set();
  const watchedFiles = new Map();
  const suppressedFileEvents = new Map();
  let started = false;
  let publicPrdWatcher = null;
  let publicPrdDebounce = null;
  let docAssetsWatcher = null;
  let docAssetsDebounce = null;

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
      const suppressedUntil = suppressedFileEvents.get(filePath) || 0;
      if (suppressedUntil > Date.now()) return;
      broadcast(event);
    };
    fs.watchFile(filePath, { interval: 300 }, listener);
    watchedFiles.set(filePath, listener);
  }

  function suppressFileChange(filePath, durationMs = 1200) {
    if (!filePath) return;
    suppressedFileEvents.set(filePath, Date.now() + durationMs);
  }

  function broadcastPrdSidecarChanged() {
    broadcast({ type: 'prd-sidecar-changed' });
  }

  function setupPublicPrdDirWatch() {
    if (!publicPrdDir || !fs.existsSync(publicPrdDir)) return;
    if (publicPrdWatcher) return;
    try {
      publicPrdWatcher = fs.watch(publicPrdDir, (eventType, filename) => {
        if (!filename) return;
        const lower = filename.toLowerCase();
        if (!/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return;
        if (publicPrdDebounce) clearTimeout(publicPrdDebounce);
        publicPrdDebounce = setTimeout(() => {
          publicPrdDebounce = null;
          broadcastPrdSidecarChanged();
        }, 120);
      });
    } catch {
      publicPrdWatcher = null;
    }
  }

  function teardownDocAssetsWatch() {
    if (docAssetsDebounce) {
      clearTimeout(docAssetsDebounce);
      docAssetsDebounce = null;
    }
    if (docAssetsWatcher) {
      try { docAssetsWatcher.close(); } catch {}
      docAssetsWatcher = null;
    }
  }

  function setupDocAssetsWatch(slug) {
    teardownDocAssetsWatch();
    if (!slug) return;
    const dir = path.join(pagesDir, slug, 'assets');
    if (!fs.existsSync(dir)) return; // 资产目录可能尚未生成，等首次写入时由下次 rewatch 触发
    try {
      docAssetsWatcher = fs.watch(dir, (eventType, filename) => {
        if (!filename) return;
        const lower = filename.toLowerCase();
        if (!/\.(png|jpe?g|webp|gif|svg)$/.test(lower)) return;
        if (docAssetsDebounce) clearTimeout(docAssetsDebounce);
        docAssetsDebounce = setTimeout(() => {
          docAssetsDebounce = null;
          broadcastPrdSidecarChanged();
        }, 120);
      });
    } catch {
      docAssetsWatcher = null;
    }
  }

  function rewatchActiveDoc() {
    for (const [fp, listener] of watchedFiles) {
      fs.unwatchFile(fp, listener);
    }
    watchedFiles.clear();
    const slug = readActiveDocSlug(pagesDir, activeFile);
    const mdFile = findDocMdFile(pagesDir, slug);
    if (mdFile) {
      watchFile(mdFile, { type: 'md-changed' });
      const annotFile = mdFileToAnnotationsPath(mdFile);
      if (fs.existsSync(annotFile)) {
        watchFile(annotFile, { type: 'prd-sidecar-changed' });
      }
    }
    setupDocAssetsWatch(slug);
  }

  return {
    start() {
      if (started) return;
      started = true;
      setupPublicPrdDirWatch();
      rewatchActiveDoc();
    },
    stop() {
      for (const [fp, listener] of watchedFiles) {
        fs.unwatchFile(fp, listener);
      }
      watchedFiles.clear();
      if (publicPrdDebounce) {
        clearTimeout(publicPrdDebounce);
        publicPrdDebounce = null;
      }
      if (publicPrdWatcher) {
        try { publicPrdWatcher.close(); } catch {}
        publicPrdWatcher = null;
      }
      teardownDocAssetsWatch();
      for (const client of clients) {
        try { client.end(); } catch {}
      }
      clients.clear();
      started = false;
    },
    rewatchActiveDoc,
    suppressFileChange,
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
