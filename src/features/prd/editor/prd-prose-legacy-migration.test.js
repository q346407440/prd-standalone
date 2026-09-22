import { describe, expect, it } from 'vitest';
import { stripLegacyProseBlockMarkers } from './prd-prose-legacy-migration.js';

describe('stripLegacyProseBlockMarkers', () => {
  it('去掉 h1–h7 与 paragraph 的 block 起始行（HTML 注释以 --> 闭合）', () => {
    const md = [
      '<!-- block:h1 -->',
      '# 标题',
      '',
      '<!-- block:paragraph -->',
      '正文',
      '',
      '<!-- block:h2 -->',
      '## 二',
    ].join('\n');
    expect(stripLegacyProseBlockMarkers(md)).toBe([
      '# 标题',
      '',
      '正文',
      '',
      '## 二',
    ].join('\n'));
  });

  it('不删 table / mermaid 等其它 block 行', () => {
    const md = [
      '<!-- block:table cols="设计" -->',
      '<!-- cell:r1:设计 -->',
      'x',
    ].join('\n');
    expect(stripLegacyProseBlockMarkers(md)).toBe(md);
  });
});
