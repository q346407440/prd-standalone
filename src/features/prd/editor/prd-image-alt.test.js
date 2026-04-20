import { describe, expect, it } from 'vitest';
import { parsePrd } from './prd-parser.js';
import { serializePrd } from './prd-writer.js';
import { serializePrdAsNativeMd } from './prd-export-native-md.js';

describe('image alt roundtrip', () => {
  it('保留段落图片与表格图片的 alt 文案', () => {
    const md = [
      '<!-- block:paragraph -->',
      '![123123](./assets/loyalty-member-offer-entry-card.png)',
      '',
      '<!-- block:table cols="设计" -->',
      '<!-- cell:r1:设计 -->',
      '![表格图片](./assets/table-image.png)',
      '',
    ].join('\n');

    const blocks = parsePrd(md);

    expect(blocks[0].content).toEqual({
      type: 'image',
      src: './assets/loyalty-member-offer-entry-card.png',
      alt: '123123',
    });
    expect(blocks[1].content.rows[0][0].elements[0]).toEqual({
      type: 'image',
      src: './assets/table-image.png',
      alt: '表格图片',
    });

    expect(serializePrd(blocks)).toContain('![123123](./assets/loyalty-member-offer-entry-card.png)');
    expect(serializePrd(blocks)).toContain('![表格图片](./assets/table-image.png)');
    expect(serializePrdAsNativeMd(blocks)).toContain('![123123](./assets/loyalty-member-offer-entry-card.png)');
    expect(serializePrdAsNativeMd(blocks)).toContain('![表格图片](./assets/table-image.png)');
  });
});
