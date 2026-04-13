#!/usr/bin/env node
/**
 * 驗證腳本：讀舊 GFM md → parsePrd → serializePrd（新格式）→ 再 parsePrd → 比對 Block 結構
 * 用法：node scripts/verify-table-migration.mjs [md-file-path]
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModules() {
  const { parsePrd } = await import('../src/features/prd/editor/prd-parser.js');
  const { serializePrd } = await import('../src/features/prd/editor/prd-writer.js');
  return { parsePrd, serializePrd };
}

function normalizeBlocksForCompare(blocks) {
  return blocks.map((b) => {
    const { id, ...rest } = b;
    if (rest.type === 'table' && rest.content) {
      const { tableId, ...contentRest } = rest.content;
      return { ...rest, content: contentRest };
    }
    return rest;
  });
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (a == null || b == null) return a == b;
  if (typeof a !== typeof b) return false;
  if (typeof a !== 'object') return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => deepEqual(v, b[i]));
  }
  const keysA = Object.keys(a).sort();
  const keysB = Object.keys(b).sort();
  if (!deepEqual(keysA, keysB)) return false;
  return keysA.every((k) => deepEqual(a[k], b[k]));
}

function findDiffs(a, b, path = '') {
  const diffs = [];
  if (a === b) return diffs;
  if (typeof a !== typeof b || a == null || b == null) {
    diffs.push({ path, a, b });
    return diffs;
  }
  if (typeof a !== 'object') {
    if (a !== b) diffs.push({ path, a, b });
    return diffs;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    for (let i = 0; i < maxLen; i++) {
      diffs.push(...findDiffs(a[i], b[i], `${path}[${i}]`));
    }
    return diffs;
  }
  const allKeys = [...new Set([...Object.keys(a || {}), ...Object.keys(b || {})])];
  for (const k of allKeys) {
    diffs.push(...findDiffs(a?.[k], b?.[k], `${path}.${k}`));
  }
  return diffs;
}

function collectMdFiles(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...collectMdFiles(full));
    } else if (entry.endsWith('.md')) {
      files.push(full);
    }
  }
  return files;
}

async function main() {
  const { parsePrd, serializePrd } = await loadModules();
  const arg = process.argv[2];

  let mdFiles;
  if (arg) {
    mdFiles = [resolve(arg)];
  } else {
    const pagesDir = join(ROOT, 'pages');
    mdFiles = collectMdFiles(pagesDir);
  }

  let passed = 0;
  let failed = 0;

  for (const filePath of mdFiles) {
    const relPath = filePath.replace(ROOT + '/', '');
    const mdText = readFileSync(filePath, 'utf-8');

    try {
      const blocks1 = parsePrd(mdText);
      const serialized = serializePrd(blocks1);
      const blocks2 = parsePrd(serialized);

      const norm1 = normalizeBlocksForCompare(blocks1);
      const norm2 = normalizeBlocksForCompare(blocks2);

      if (deepEqual(norm1, norm2)) {
        console.log(`✓ ${relPath}`);
        passed++;
      } else {
        const diffs = findDiffs(norm1, norm2);
        console.log(`✗ ${relPath} — ${diffs.length} diff(s):`);
        for (const d of diffs.slice(0, 5)) {
          console.log(`  ${d.path}:`);
          console.log(`    old: ${JSON.stringify(d.a)?.slice(0, 120)}`);
          console.log(`    new: ${JSON.stringify(d.b)?.slice(0, 120)}`);
        }
        if (diffs.length > 5) console.log(`  ... and ${diffs.length - 5} more`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ ${relPath} — ERROR: ${err.message}`);
      failed++;
    }
  }

  console.log(`\n${passed} passed, ${failed} failed out of ${mdFiles.length} file(s).`);
  process.exit(failed > 0 ? 1 : 0);
}

main();
