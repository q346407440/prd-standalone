import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePrd } from './prd-parser.js';
import { serializePrd } from './prd-writer.js';
import {
  computePrdMdCursorLineOneBased,
  extractPrdSnippetForCopy,
  formatPrdCopyPathAndSnippet,
} from './prd-md-cursor-ref.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../../../..');

describe('computePrdMdCursorLineOneBased', () => {
  it('matches Loyalty doc first image line in 2.1.1 design cell (known file snapshot)', () => {
    const mdPath = path.join(repoRoot, 'pages/doc-001/Loyalty弹窗需求.md');
    if (!fs.existsSync(mdPath)) return;
    const md = fs.readFileSync(mdPath, 'utf8');
    const blocks = parsePrd(md);
    const ser = serializePrd(blocks);
    const expectedLine = ser.split('\n').findIndex((line) => (
      line.includes('member-offer-editor-shell-layout-20260415.png')
    )) + 1;
    if (expectedLine <= 0) return;
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
    expect(line).toBe(expectedLine);
  });

  it('returns first content line for block when cellPath is null', () => {
    const md = `<!-- block:h2 -->\n## Hello\n\n<!-- block:paragraph -->\nBody here`;
    const blocks = parsePrd(md);
    const p = blocks.find((b) => b.type === 'paragraph');
    expect(p).toBeTruthy();
    const line = computePrdMdCursorLineOneBased(blocks, p.id, null);
    const ser = serializePrd(blocks);
    const serializedLine = ser.split('\n').findIndex((l) => l === 'Body here') + 1;
    expect(line).toBe(serializedLine);
  });

  it('顶层无空行列表拆成多块后仍序列化为三行；各行号对应各自 block', () => {
    const blocks = parsePrd([
      '* 第一行',
      '* 第二行',
      '* 第三行',
    ].join('\n'));
    const paras = blocks.filter((b) => b.type === 'paragraph');
    expect(paras.length).toBe(3);
    expect(paras[1].content.tightJoinPrev).toBe(true);
    const ser = serializePrd(blocks).trimEnd();
    expect(ser).toBe(['* 第一行', '* 第二行', '* 第三行'].join('\n'));
    const line0 = computePrdMdCursorLineOneBased(blocks, paras[0].id, null, null, { contentBodyLineOffset: 0 });
    const line2 = computePrdMdCursorLineOneBased(blocks, paras[2].id, null, null, { contentBodyLineOffset: 0 });
    expect(ser.split('\n')[line0 - 1].trim()).toBe('* 第一行');
    expect(ser.split('\n')[line2 - 1].trim()).toBe('* 第三行');
    expect(line2).toBe(line0 + 2);
  });

  it('行号与 serializePrd 正文一致（v3 无 prose block 行）', () => {
    const mdPath = path.join(repoRoot, 'pages/doc-001/Loyalty弹窗需求.md');
    if (!fs.existsSync(mdPath)) return;
    const md = fs.readFileSync(mdPath, 'utf8');
    const blocks = parsePrd(md);
    const h4 = blocks.find(
      (b) => b.type === 'h4'
        && String(b.content?.markdown || '').includes('2.1.1 会员弹窗-编辑器-整页结构'),
    );
    expect(h4).toBeTruthy();
    const ser = serializePrd(blocks);
    const serHeadingLine = ser.split('\n').findIndex((l) => l.includes('2.1.1 会员弹窗-编辑器-整页结构')) + 1;
    expect(serHeadingLine).toBeGreaterThan(0);
    const lineFromSerialize = computePrdMdCursorLineOneBased(blocks, h4.id, null);
    expect(lineFromSerialize).toBe(serHeadingLine);
    void md;
  });

  it('前一块正文以换行结尾时 glue 会产生 \\n\\n\\n，折叠后与 serializePrd 行号一致', () => {
    const blocks = [
      { id: 'p1', type: 'paragraph', content: { type: 'text', markdown: 'first\n' } },
      { id: 'p2', type: 'paragraph', content: { type: 'text', markdown: 'second' } },
    ];
    const ser = serializePrd(blocks);
    expect(ser).toMatch(/^first\n\nsecond\n$/);
    const expectedLine = ser.split('\n').findIndex((l) => l === 'second') + 1;
    expect(expectedLine).toBe(3);
    expect(computePrdMdCursorLineOneBased(blocks, 'p2', null)).toBe(expectedLine);
  });

  it('<!-- /block:table --> 不计入表格 cell 内容行区间', () => {
    const md = [
      '<!-- block:table cols="设计" -->',
      '<!-- cell:r1:设计 -->',
      'x',
      '<!-- /block:table -->',
      '<!-- block:paragraph -->',
      'p',
    ].join('\n');
    const blocks = parsePrd(md);
    const tb = blocks.find((b) => b.type === 'table');
    expect(tb).toBeTruthy();
    const ser = serializePrd(blocks);
    const line = computePrdMdCursorLineOneBased(blocks, tb.id, { ri: 0, ci: 0, idx: 0 }, ser);
    const cellMarkerLine = ser.split('\n').findIndex((l) => l.trim() === '<!-- cell:r1:设计 -->') + 1;
    expect(line).toBe(cellMarkerLine + 1);
  });
});

describe('extractPrdSnippetForCopy / formatPrdCopyPathAndSnippet', () => {
  it('标题块复制为带 # 的整行标题', () => {
    const blocks = [{ id: 'h', type: 'h3', content: { type: 'text', markdown: '小节' } }];
    expect(extractPrdSnippetForCopy(blocks, 'h', null)).toBe('### 小节');
  });

  it('多行 paragraph 按 contentBodyLineOffset 取单行', () => {
    const blocks = [{
      id: 'p',
      type: 'paragraph',
      content: { type: 'text', markdown: 'a\nb\nc' },
    }];
    expect(extractPrdSnippetForCopy(blocks, 'p', null, { contentBodyLineOffset: 1 })).toBe('b');
  });

  it('表格格内按元素 idx 截取 serializeCellContent 子串', () => {
    const md = [
      '<!-- block:table cols="A,B" -->',
      '<!-- cell:r1:A -->',
      'foo',
      '<!-- cell:r1:B -->',
      'x',
      '<!-- cell:r2:B -->',
      'tail',
      '<!-- /block:table -->',
    ].join('\n');
    const blocks = parsePrd(md);
    const tb = blocks.find((b) => b.type === 'table');
    expect(tb).toBeTruthy();
    expect(extractPrdSnippetForCopy(blocks, tb.id, { ri: 0, ci: 1, idx: 0 })).toBe('x');
  });

  it('formatPrdCopyPathAndSnippet 无片段时仅路径行', () => {
    expect(formatPrdCopyPathAndSnippet('/pages/doc-001/x.md', 'repo', '  \n')).toBe('@repo/pages/doc-001/x.md');
  });

  it('formatPrdCopyPathAndSnippet 有片段时路径后空行再接正文', () => {
    const s = formatPrdCopyPathAndSnippet('/pages/a.md', 'prd-standalone', 'hello');
    expect(s).toBe('@prd-standalone/pages/a.md\n\nhello');
  });
});
