import { describe, expect, it } from 'vitest';
import { parsePrd } from './prd-parser.js';

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
});
