#!/usr/bin/env node
/**
 * 把 public/prd/<file>.png 迁移到 pages/<slug>/assets/<file>.png（colocated assets）。
 *
 * 行为：
 *   - 扫描 pages/<slug>/<doc>.md 中所有 ![](/prd/xxx.ext) 引用
 *   - 复制 public/prd/<file> → pages/<slug>/assets/<file>（共享图每个 doc 各一份）
 *   - 重写 .md：/prd/xxx.ext → ./assets/xxx.ext
 *   - **不动** .annotations.json（用户决定先保留旧路径）
 *   - **不删** public/prd/ 下任何文件（后端兼容期还要服务 GET /prd/）
 *   - 备份原 .md 到 .local/asset-migration-backup-<ts>/pages/<slug>/<doc>.md
 *
 * 用法：
 *   node scripts/migrate-assets-to-doc-folders.mjs [--dry-run] [--force]
 *     --dry-run  仅打印计划，不写盘
 *     --force    跳过 git 工作区是否干净检查（默认会拦截）
 *
 * 报告：
 *   - 每 doc：copied / skipped(已存在) / missing(public/prd 找不到) 文件清单
 *   - annotations-only refs：仅在 .annotations.json 出现、MD 不再用的 /prd/ 引用
 *   - orphan files：public/prd/ 中谁都没引用的图（仅提示，不动）
 */

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  mkdirSync,
  copyFileSync,
} from 'fs';
import { join, resolve, dirname, relative } from 'path';
import { execSync } from 'child_process';

const ROOT = resolve(import.meta.dirname, '..');
const PAGES_DIR = join(ROOT, 'pages');
const PUBLIC_PRD_DIR = join(ROOT, 'public', 'prd');
const BACKUP_ROOT = join(ROOT, '.local', `asset-migration-backup-${formatTs()}`);

const args = new Set(process.argv.slice(2));
const DRY_RUN = args.has('--dry-run');
const FORCE = args.has('--force');

function formatTs() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function checkGitClean() {
  try {
    const out = execSync('git status --porcelain', { cwd: ROOT, encoding: 'utf-8' });
    if (out.trim()) {
      console.error('✗ Git 工作区有未提交改动：');
      console.error(out);
      console.error('  迁移会改写 pages/*/*.md，请先 commit / stash，或加 --force 跳过此检查。');
      return false;
    }
    return true;
  } catch (err) {
    console.warn(`! 无法执行 git status（${err.message}），跳过检查。`);
    return true;
  }
}

function listDocSlugs() {
  if (!existsSync(PAGES_DIR)) return [];
  return readdirSync(PAGES_DIR)
    .filter((name) => /^doc-\d+$/.test(name))
    .filter((name) => statSync(join(PAGES_DIR, name)).isDirectory())
    .sort();
}

function findDocMd(slug) {
  const dir = join(PAGES_DIR, slug);
  const entries = readdirSync(dir).filter((name) => name.endsWith('.md'));
  return entries.length === 1 ? join(dir, entries[0]) : null;
}

function findAnnotationsJson(slug) {
  const dir = join(PAGES_DIR, slug);
  const entries = readdirSync(dir).filter((name) => name.endsWith('.annotations.json'));
  return entries.length === 1 ? join(dir, entries[0]) : null;
}

const PRD_PATH_RE = /\/prd\/([^)\s"'<>]+\.(?:png|jpe?g|gif|webp|svg|bmp))/gi;

function extractPrdPaths(text) {
  const set = new Set();
  if (!text) return set;
  let m;
  PRD_PATH_RE.lastIndex = 0;
  while ((m = PRD_PATH_RE.exec(text)) !== null) {
    set.add(m[1]); // 不含 /prd/ 前缀的 basename
  }
  return set;
}

function ensureDir(dir) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function backupFile(srcAbs) {
  const rel = relative(ROOT, srcAbs);
  const destAbs = join(BACKUP_ROOT, rel);
  ensureDir(dirname(destAbs));
  copyFileSync(srcAbs, destAbs);
  return destAbs;
}

function rewriteMdPaths(md, copiedNames) {
  // 仅替换实际复制成功的图，避免误改 missing 引用
  let next = md;
  for (const name of copiedNames) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`/prd/${escaped}(?=[)\\s"'<>])`, 'g');
    next = next.replace(re, `./assets/${name}`);
  }
  return next;
}

async function main() {
  console.log(`# Migrate assets → pages/<slug>/assets/`);
  console.log(`  ROOT          ${ROOT}`);
  console.log(`  PAGES_DIR     ${PAGES_DIR}`);
  console.log(`  PUBLIC_PRD    ${PUBLIC_PRD_DIR}`);
  console.log(`  BACKUP_ROOT   ${BACKUP_ROOT}`);
  console.log(`  DRY_RUN       ${DRY_RUN}`);
  console.log(`  FORCE         ${FORCE}`);
  console.log('');

  if (!FORCE && !DRY_RUN) {
    if (!checkGitClean()) process.exit(1);
  }

  if (!existsSync(PUBLIC_PRD_DIR)) {
    console.error(`✗ 找不到 public/prd/，无可迁移源`);
    process.exit(1);
  }

  const slugs = listDocSlugs();
  if (slugs.length === 0) {
    console.error(`✗ pages/ 下没有 doc-* 目录`);
    process.exit(1);
  }

  const allReferenced = new Set();
  const perDocReports = [];

  for (const slug of slugs) {
    const mdPath = findDocMd(slug);
    if (!mdPath) {
      console.warn(`! ${slug}: 未找到唯一 .md 文件，跳过`);
      perDocReports.push({ slug, skipped: true });
      continue;
    }
    const annPath = findAnnotationsJson(slug);
    const mdText = readFileSync(mdPath, 'utf-8');
    const annText = annPath && existsSync(annPath) ? readFileSync(annPath, 'utf-8') : '';

    const mdRefs = extractPrdPaths(mdText);
    const annRefs = extractPrdPaths(annText);
    const onlyInAnn = [...annRefs].filter((n) => !mdRefs.has(n)).sort();

    const assetsDir = join(PAGES_DIR, slug, 'assets');

    const copied = [];
    const skippedExist = [];
    const missing = [];

    for (const name of [...mdRefs].sort()) {
      allReferenced.add(name);
      const srcAbs = join(PUBLIC_PRD_DIR, name);
      const destAbs = join(assetsDir, name);
      if (!existsSync(srcAbs)) {
        missing.push(name);
        continue;
      }
      if (existsSync(destAbs)) {
        skippedExist.push(name);
        continue;
      }
      if (DRY_RUN) {
        copied.push(name);
        continue;
      }
      ensureDir(dirname(destAbs));
      copyFileSync(srcAbs, destAbs);
      copied.push(name);
    }

    // 重写 MD：copied + skippedExist 都视为目标已就位，可以重写
    const rewriteSet = [...new Set([...copied, ...skippedExist])];
    const newMd = rewriteMdPaths(mdText, rewriteSet);
    const mdChanged = newMd !== mdText;
    if (mdChanged && !DRY_RUN) {
      backupFile(mdPath);
      writeFileSync(mdPath, newMd, 'utf-8');
    }

    perDocReports.push({
      slug,
      mdPath: relative(ROOT, mdPath),
      annPath: annPath ? relative(ROOT, annPath) : null,
      copied,
      skippedExist,
      missing,
      onlyInAnn,
      mdChanged,
    });
  }

  // orphans
  const allInPublic = readdirSync(PUBLIC_PRD_DIR).filter((name) => {
    if (!/\.(png|jpe?g|gif|webp|svg|bmp)$/i.test(name)) return false;
    return statSync(join(PUBLIC_PRD_DIR, name)).isFile();
  });
  const orphans = allInPublic.filter((name) => !allReferenced.has(name)).sort();

  console.log('## 报告\n');
  for (const r of perDocReports) {
    if (r.skipped) {
      console.log(`### ${r.slug} —— SKIPPED\n`);
      continue;
    }
    console.log(`### ${r.slug}`);
    console.log(`  md            ${r.mdPath}`);
    console.log(`  annotations   ${r.annPath || '(none)'}`);
    console.log(`  copied        ${r.copied.length}`);
    if (r.copied.length) for (const n of r.copied) console.log(`    + ${n}`);
    console.log(`  skip-exists   ${r.skippedExist.length}`);
    if (r.skippedExist.length) for (const n of r.skippedExist) console.log(`    = ${n}`);
    console.log(`  missing       ${r.missing.length}`);
    if (r.missing.length) for (const n of r.missing) console.log(`    ? ${n}`);
    console.log(`  ann-only refs ${r.onlyInAnn.length}`);
    if (r.onlyInAnn.length) for (const n of r.onlyInAnn) console.log(`    ~ ${n}`);
    console.log(`  md-rewritten  ${r.mdChanged ? 'YES' : 'no'}`);
    console.log('');
  }

  console.log(`## 全局\n`);
  console.log(`  public/prd/ 下文件总数 ${allInPublic.length}`);
  console.log(`  被任一 MD 引用的    ${allReferenced.size}`);
  console.log(`  orphan（无人引用）  ${orphans.length}`);
  if (orphans.length && orphans.length <= 50) {
    for (const n of orphans) console.log(`    o ${n}`);
  } else if (orphans.length) {
    for (const n of orphans.slice(0, 30)) console.log(`    o ${n}`);
    console.log(`    ... ${orphans.length - 30} more`);
  }
  console.log('');

  if (DRY_RUN) {
    console.log('[DRY RUN] 未写盘。如确认，去掉 --dry-run 重新执行。');
  } else {
    console.log(`✓ 完成。备份目录：${relative(ROOT, BACKUP_ROOT)}`);
    console.log('  注：public/prd/ 原文件未删除（后端仍提供兼容路由）。');
    console.log('  注：.annotations.json 未改写（用户暂保留）。');
  }
}

main().catch((err) => {
  console.error('✗ 迁移失败：', err);
  process.exit(1);
});
