import { describe, expect, it } from 'vitest';
import { parsePrd } from './prd-parser.js';
import { serializePrd } from './prd-writer.js';
import { reconcileTightJoinPrevForParagraphRuns } from './prd-block-operations.js';
import { ensureIslandEndMarkers } from './prd-island-block-markers.js';

describe('parsePrd', () => {
  it('保留 paragraph 首行的合法列表缩进', () => {
    const blocks = parsePrd([
      '<!-- block:paragraph -->',
      '  - 嗯？',
      '',
      '<!-- block:paragraph -->',
      '- 根级',
      '',
    ].join('\n'));

    expect(blocks[0]).toMatchObject({
      type: 'paragraph',
      content: { type: 'text', markdown: '  - 嗯？' },
    });
    expect(blocks[1]).toMatchObject({
      type: 'paragraph',
      content: { type: 'text', markdown: '- 根级' },
    });
  });

  it('mindmap 以 <!-- /block:mindmap --> 结束时正文不含 end 行', () => {
    const md = [
      '<!-- block:mindmap -->',
      '- 主题',
      '<!-- /block:mindmap -->',
      '<!-- block:paragraph -->',
      'x',
    ].join('\n');
    const blocks = parsePrd(md);
    const mm = blocks.find((b) => b.type === 'mindmap');
    expect(mm?.content?.code?.trim()).toBe('- 主题');
  });

  it('无 end 的 mindmap 与补全 end 后解析等价', () => {
    const legacy = [
      '<!-- block:mindmap -->',
      '- A',
      '<!-- block:paragraph -->',
      'b',
    ].join('\n');
    const fixed = ensureIslandEndMarkers(legacy);
    const a = parsePrd(legacy).find((b) => b.type === 'mindmap');
    const b = parsePrd(fixed).find((b) => b.type === 'mindmap');
    expect(a?.content?.code).toBe(b?.content?.code);
  });

  it('table / mermaid 与 serializePrd 可 round-trip', () => {
    const md = [
      '<!-- block:table cols="C" -->',
      '<!-- cell:r1:C -->',
      'cell',
      '<!-- block:mermaid -->',
      '```mermaid',
      'graph LR',
      '  A-->B',
      '```',
    ].join('\n');
    const blocks = parsePrd(ensureIslandEndMarkers(md));
    const again = parsePrd(serializePrd(blocks));
    expect(again.find((b) => b.type === 'table')?.content?.rows?.[0]?.[0]).toEqual(
      blocks.find((b) => b.type === 'table')?.content?.rows?.[0]?.[0],
    );
    expect(again.find((b) => b.type === 'mermaid')?.content?.code).toContain('A-->B');
  });

  it('GFM 管道表在正文区解析为 table 块，序列化为 cell 标记表格', () => {
    const md = [
      '| 列 A | 列 B |',
      '| --- | --- |',
      '| 1 | 2 |',
    ].join('\n');
    const blocks = parsePrd(md);
    const t = blocks.find((b) => b.type === 'table');
    expect(t).toBeTruthy();
    expect(t.content.headers).toEqual(['列 A', '列 B']);
    expect(t.content.rows).toHaveLength(1);
    const ser = serializePrd(blocks);
    expect(ser).toContain('<!-- block:table cols="列 A,列 B" -->');
    expect(ser).toContain('<!-- cell:r1:列 A -->');
    expect(ser).toContain('<!-- /block:table -->');
  });

  it('标题与 GFM 表之间无空行时仍拆成 h* + table 两块', () => {
    const md = [
      '## 模块',
      '| x | y |',
      '| --- | --- |',
      '| a | b |',
    ].join('\n');
    const blocks = parsePrd(md);
    expect(blocks.map((b) => b.type)).toEqual(['h2', 'table']);
    expect(blocks[1].content.headers).toEqual(['x', 'y']);
  });

  it('标题行内粗体解析为纯文本，序列化不写 ** 与反斜杠转义', () => {
    const md = '# **一、**背景\n\n正文。';
    const blocks = parsePrd(md);
    const h = blocks.find((b) => b.type === 'h1');
    expect(h?.content?.markdown).toBe('一、背景');
    const out = serializePrd(blocks);
    expect(out).toContain('# 一、背景');
    expect(out).not.toMatch(/\\\*一/);
  });

  it('无空行顶层列表拆块后与 serializePrd round-trip', () => {
    const md = ['* a', '* b', '* c'].join('\n');
    const blocks = parsePrd(md);
    expect(blocks.filter((b) => b.type === 'paragraph')).toHaveLength(3);
    expect(serializePrd(blocks).trimEnd()).toBe(md);
    const again = parsePrd(serializePrd(blocks));
    expect(again.filter((b) => b.type === 'paragraph')).toHaveLength(3);
  });

  it('任意非列表前言行 + 紧接无空行顶层列表：拆多块且 round-trip', () => {
    const md = [
      '**引导行（非列表）**',
      '* **项一**：a',
      '* **项二**：b',
      '* **项三**：c',
    ].join('\n');
    const blocks = parsePrd(md);
    const paras = blocks.filter((b) => b.type === 'paragraph');
    expect(paras.length).toBe(4);
    expect(paras[1].content.tightJoinPrev).toBe(true);
    expect(serializePrd(blocks).trimEnd()).toBe(md);
    expect(parsePrd(serializePrd(blocks)).filter((b) => b.type === 'paragraph')).toHaveLength(4);
  });

  it('block:divider 后紧跟的 prose 不被吞进 divider 块', () => {
    const md = [
      '<!-- block:divider -->',
      '---',
      '',
      '### 4.3 补充技巧',
      '',
      '#### 补充一：示例',
      '',
      '<!-- block:table cols="A,B" -->',
      '<!-- cell:r1:A -->',
      'a',
      '<!-- cell:r1:B -->',
      'b',
      '<!-- /block:table -->',
    ].join('\n');
    const blocks = parsePrd(md);
    expect(blocks.some((b) => b.type === 'h3' && b.content.markdown.includes('4.3'))).toBe(true);
    expect(blocks.some((b) => b.type === 'h4' && b.content.markdown.includes('补充一'))).toBe(true);
    const divIdx = blocks.findIndex((b) => b.type === 'divider');
    const h3Idx = blocks.findIndex((b) => b.type === 'h3');
    expect(divIdx).toBeGreaterThanOrEqual(0);
    expect(h3Idx).toBeGreaterThan(divIdx);
  });

  it('交换相邻列表块后 reconcile 仍无列表项间空行', () => {
    const md = ['* a', '* b', '* c'].join('\n');
    let blocks = parsePrd(md);
    const paras = blocks.filter((b) => b.type === 'paragraph');
    expect(paras).toHaveLength(3);
    const i0 = blocks.findIndex((b) => b.id === paras[0].id);
    const i1 = blocks.findIndex((b) => b.id === paras[1].id);
    const next = [...blocks];
    [next[i0], next[i1]] = [next[i1], next[i0]];
    blocks = reconcileTightJoinPrevForParagraphRuns(next);
    const ser = serializePrd(blocks).trimEnd();
    expect(ser).not.toMatch(/\*\s+[^\n]+\n\n\*/);
    expect(ser.split('\n').filter(Boolean)).toHaveLength(3);
  });
});
