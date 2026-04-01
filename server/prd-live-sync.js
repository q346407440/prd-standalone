import fs from 'fs';
import { readActiveDocSlug, findDocMdFile } from './prd-doc-handlers.js';

export function createPrdLiveSync({ pagesDir, activeFile }) {
  const clients = new Set();
  const watchedFiles = new Map();
  const suppressedFileEvents = new Map();
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

  function rewatchActiveDoc() {
    for (const [fp, listener] of watchedFiles) {
      fs.unwatchFile(fp, listener);
    }
    watchedFiles.clear();
    const slug = readActiveDocSlug(pagesDir, activeFile);
    const mdFile = findDocMdFile(pagesDir, slug);
    if (mdFile) watchFile(mdFile, { type: 'md-changed' });
  }

  return {
    start() {
      if (started) return;
      started = true;
      rewatchActiveDoc();
    },
    stop() {
      for (const [fp, listener] of watchedFiles) {
        fs.unwatchFile(fp, listener);
      }
      watchedFiles.clear();
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
