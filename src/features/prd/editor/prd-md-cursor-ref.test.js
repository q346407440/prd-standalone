import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrd } from './prd-parser.js';
import { computePrdMdCursorLineOneBased } from './prd-md-cursor-ref.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

describe('computePrdMdCursorLineOneBased', () => {
  it('matches Loyalty doc first image line in 2.1.1 design cell (known file snapshot)', () => {
    const mdPath = path.join(repoRoot, 'pages/doc-001/Loyalty弹窗需求.md');
    if (!fs.existsSync(mdPath)) return;
    const md = fs.readFileSync(mdPath, 'utf8');
    const blocks = parsePrd(md);
    const expectedLine = md.split('\n').findIndex((line) => (
      line.trim() === '![](./assets/member-offer-editor-shell-layout-20260415.png)'
    )) + 1;
    const tableBlock = blocks.find(
      (b) => b.type === 'table'
        && (b.content?.headers || []).includes('设计/原型稿')
        && (b.content?.rows?.[0]?.[0]?.elements || []).some(
          (el) => el.type === 'image' && String(el.src || '').includes('member-offer-editor-shell-layout'),
        ),
    );
    expect(tableBlock).toBeTruthy();
    const line = computePrdMdCursorLineOneBased(blocks, tableBlock.id, {
      ri: 0,
      ci: 0,
      idx: 0,
    }, md);
    expect(expectedLine).toBeGreaterThan(0);
    expect(line).toBe(expectedLine);
  });

  it('returns first content line for block when cellPath is null', () => {
    const md = `<!-- block:h2 -->\n## Hello\n\n<!-- block:paragraph -->\nBody here`;
    const blocks = parsePrd(md);
    const p = blocks.find((b) => b.type === 'paragraph');
    expect(p).toBeTruthy();
    const line = computePrdMdCursorLineOneBased(blocks, p.id, null);
    const serializedLine = md.split('\n').findIndex((l) => l === 'Body here') + 1;
    expect(line).toBe(serializedLine);
  });

  it('mdSource and serialize both align heading line with on-disk file for current Loyalty doc', () => {
    const mdPath = path.join(repoRoot, 'pages/doc-001/Loyalty弹窗需求.md');
    if (!fs.existsSync(mdPath)) return;
    const md = fs.readFileSync(mdPath, 'utf8');
    const blocks = parsePrd(md);
    const h4 = blocks.find(
      (b) => b.type === 'h4'
        && String(b.content?.markdown || '').includes('2.1.1 会员弹窗-编辑器-整页结构'),
    );
    expect(h4).toBeTruthy();
    const lineFromSerialize = computePrdMdCursorLineOneBased(blocks, h4.id, null);
    const lineFromDiskMd = computePrdMdCursorLineOneBased(blocks, h4.id, null, md);
    const diskHeadingLine = md.split('\n').findIndex((l) => l.includes('2.1.1 会员弹窗-编辑器-整页结构')) + 1;
    expect(diskHeadingLine).toBeGreaterThan(0);
    expect(lineFromSerialize).toBe(diskHeadingLine);
    expect(lineFromDiskMd).toBe(diskHeadingLine);
  });
});
