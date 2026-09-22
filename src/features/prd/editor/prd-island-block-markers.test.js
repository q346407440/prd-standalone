import { describe, expect, it } from 'vitest';
import {
  ensureIslandEndMarkers,
  BLOCK_OPENING_LINE_RE,
} from './prd-island-block-markers.js';

describe('ensureIslandEndMarkers', () => {
  it('在下一个 block opening 前插入缺失的 /block:mindmap', () => {
    const md = [
      '<!-- block:mindmap -->',
      '- 根',
      '  - 子',
      '<!-- block:paragraph -->',
      '正文',
    ].join('\n');
    const out = ensureIslandEndMarkers(md);
    expect(out).toContain('<!-- /block:mindmap -->');
    expect(out.indexOf('<!-- /block:mindmap -->')).toBeLessThan(out.indexOf('<!-- block:paragraph -->'));
  });

  it('文末无后续 block 时在末尾追加 /block:table', () => {
    const md = [
      '<!-- block:table cols="A,B" -->',
      '<!-- cell:r1:A -->',
      'x',
    ].join('\n');
    const out = ensureIslandEndMarkers(md);
    expect(out.trimEnd().endsWith('<!-- /block:table -->')).toBe(true);
  });

  it('已有匹配 end 时不重复插入', () => {
    const md = [
      '<!-- block:mermaid -->',
      '```mermaid',
      'graph LR',
      '```',
      '<!-- /block:mermaid -->',
      '<!-- block:h2 -->',
      '## T',
    ].join('\n');
    const out = ensureIslandEndMarkers(md);
    expect((out.match(/<!-- \/block:mermaid -->/g) || []).length).toBe(1);
  });

  it('不把 <!-- cell: 当作下一 opening', () => {
    const md = [
      '<!-- block:table cols="设计" -->',
      '<!-- cell:r1:设计 -->',
      '![a](./assets/x.png)',
      '<!-- block:paragraph -->',
      'p',
    ].join('\n');
    const out = ensureIslandEndMarkers(md);
    const cellIdx = out.indexOf('<!-- cell:r1:设计 -->');
    const endIdx = out.indexOf('<!-- /block:table -->');
    const pIdx = out.indexOf('<!-- block:paragraph -->');
    expect(endIdx).toBeGreaterThan(cellIdx);
    expect(pIdx).toBeGreaterThan(endIdx);
  });
});

describe('BLOCK_OPENING_LINE_RE', () => {
  it('匹配带 cols 的 table opening', () => {
    expect(
      '<!-- block:table cols="设计,交互,逻辑" -->'.trim().match(BLOCK_OPENING_LINE_RE)?.[1],
    ).toBe('table');
  });
});
