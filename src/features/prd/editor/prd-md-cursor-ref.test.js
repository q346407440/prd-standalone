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
    });
    expect(line).toBe(79);
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
});
