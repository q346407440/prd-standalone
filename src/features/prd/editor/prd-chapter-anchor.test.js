import { describe, it, expect } from 'vitest';
import {
  extractStrongChapterRef,
  extractHeadingChapterPrefix,
  buildChapterIndex,
} from './prd-chapter-anchor.js';

describe('extractStrongChapterRef', () => {
  it('matches multi-segment chapter numbers', () => {
    expect(extractStrongChapterRef('2.1.5')).toBe('2.1.5');
    expect(extractStrongChapterRef('2.3')).toBe('2.3');
    expect(extractStrongChapterRef('  2.1.5  ')).toBe('2.1.5');
  });

  it('rejects single-segment numbers and non-pure forms', () => {
    expect(extractStrongChapterRef('2')).toBeNull();
    expect(extractStrongChapterRef('v2.0')).toBeNull();
    expect(extractStrongChapterRef('2.1.5 节')).toBeNull();
    expect(extractStrongChapterRef('近 30 天')).toBeNull();
    expect(extractStrongChapterRef('')).toBeNull();
    expect(extractStrongChapterRef(null)).toBeNull();
  });
});

describe('extractHeadingChapterPrefix', () => {
  it('extracts numeric prefix from common heading formats', () => {
    expect(extractHeadingChapterPrefix('2.1 弹窗策略配置')).toBe('2.1');
    expect(extractHeadingChapterPrefix('2.1.5 可出现页面')).toBe('2.1.5');
    expect(extractHeadingChapterPrefix('1. 目的 / 背景')).toBe('1');
    expect(extractHeadingChapterPrefix('2. 需求功能清单')).toBe('2');
    expect(extractHeadingChapterPrefix('2.1.5、可出现页面')).toBe('2.1.5');
    expect(extractHeadingChapterPrefix('2.1.5：可出现页面')).toBe('2.1.5');
  });

  it('returns null when heading does not start with a number', () => {
    expect(extractHeadingChapterPrefix('需求概述')).toBeNull();
    expect(extractHeadingChapterPrefix('')).toBeNull();
  });
});

function mkHeading(id, type, text) {
  return { id, type, content: { type: 'text', markdown: text } };
}

describe('buildChapterIndex', () => {
  it('resolves chapter to the heading inside the same h1 scope (current h1 preferred)', () => {
    const blocks = [
      mkHeading('H1A', 'h1', '需求概述'),
      mkHeading('A1', 'h2', '1. 目的 / 背景'),
      mkHeading('A2', 'h2', '2. 需求功能清单'),
      mkHeading('H1B', 'h1', '产品详细功能说明'),
      mkHeading('B1', 'h2', '1. 需求入口-商家端'),
      mkHeading('B2', 'h2', '2. 会员权益弹窗编辑器-商家端'),
      mkHeading('B21', 'h3', '2.1 弹窗策略配置'),
      mkHeading('B215', 'h4', '2.1.5 可出现页面'),
      { id: 'P1', type: 'paragraph', content: { type: 'text', markdown: 'context inside H1B' } },
    ];
    const idx = buildChapterIndex(blocks);
    expect(idx.resolve('2.1.5', 'P1')).toBe('B215');
    expect(idx.resolve('2.1', 'P1')).toBe('B21');
    expect(idx.getH1Scope('P1')).toBe('H1B');
    expect(idx.getH1Scope('A1')).toBe('H1A');
  });

  it('falls back to global unique match when current scope has no candidate', () => {
    const blocks = [
      mkHeading('H1A', 'h1', '需求概述'),
      { id: 'PA', type: 'paragraph', content: { type: 'text', markdown: 'context in H1A' } },
      mkHeading('H1B', 'h1', '产品详细功能说明'),
      mkHeading('B215', 'h4', '2.1.5 可出现页面'),
    ];
    const idx = buildChapterIndex(blocks);
    expect(idx.resolve('2.1.5', 'PA')).toBe('B215');
  });

  it('returns null on cross-h1 ambiguity when context is outside any h1', () => {
    const blocks = [
      { id: 'POrphan', type: 'paragraph', content: { type: 'text', markdown: 'before any h1' } },
      mkHeading('H1A', 'h1', '需求概述'),
      mkHeading('A21', 'h3', '2.1 旧分节'),
      mkHeading('H1B', 'h1', '产品详细功能说明'),
      mkHeading('B21', 'h3', '2.1 新分节'),
    ];
    const idx = buildChapterIndex(blocks);
    expect(idx.getH1Scope('POrphan')).toBeNull();
    expect(idx.resolve('2.1', 'POrphan')).toBeNull();
  });

  it('returns null when chapter is not found at all', () => {
    const blocks = [
      mkHeading('H1A', 'h1', '需求概述'),
      mkHeading('A2', 'h2', '2. 需求功能清单'),
      { id: 'P1', type: 'paragraph', content: { type: 'text', markdown: 'x' } },
    ];
    const idx = buildChapterIndex(blocks);
    expect(idx.resolve('99.99.99', 'P1')).toBeNull();
  });

  it('prefers the first match within current h1 when same chapter appears twice in same h1 (rare)', () => {
    const blocks = [
      mkHeading('H1', 'h1', '产品详细功能说明'),
      mkHeading('First', 'h3', '2.1 第一处'),
      mkHeading('Second', 'h3', '2.1 第二处'),
      { id: 'P', type: 'paragraph', content: { type: 'text', markdown: 'x' } },
    ];
    const idx = buildChapterIndex(blocks);
    expect(idx.resolve('2.1', 'P')).toBe('First');
  });
});
