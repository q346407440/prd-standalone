#!/usr/bin/env node
// 批量遷移 pages/*/*.md 的表格為新格式（cell 標記）。
// 用法：node scripts/migrate-tables.mjs [--dry-run]

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';

const ROOT = resolve(import.meta.dirname, '..');

async function loadModules() {
  const { parsePrd } = await import('../src/features/prd/editor/prd-parser.js');
  const { serializePrd } = await import('../src/features/prd/editor/prd-writer.js');
  return { parsePrd, serializePrd };
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
  const dryRun = process.argv.includes('--dry-run');
  const { parsePrd, serializePrd } = await loadModules();
  const pagesDir = join(ROOT, 'pages');
  const mdFiles = collectMdFiles(pagesDir);

  let migrated = 0;
  let unchanged = 0;
  let errors = 0;

  for (const filePath of mdFiles) {
    const relPath = filePath.replace(ROOT + '/', '');
    const mdText = readFileSync(filePath, 'utf-8');

    try {
      const blocks = parsePrd(mdText);
      const newText = serializePrd(blocks);

      if (newText === mdText) {
        console.log(`  skip ${relPath} (already new format)`);
        unchanged++;
      } else {
        if (dryRun) {
          console.log(`  would migrate ${relPath}`);
        } else {
          writeFileSync(filePath, newText, 'utf-8');
          console.log(`  ✓ migrated ${relPath}`);
        }
        migrated++;
      }
    } catch (err) {
      console.log(`  ✗ ${relPath} — ERROR: ${err.message}`);
      errors++;
    }
  }

  console.log(`\n${dryRun ? '[DRY RUN] ' : ''}${migrated} migrated, ${unchanged} unchanged, ${errors} errors out of ${mdFiles.length} file(s).`);
}

main();
