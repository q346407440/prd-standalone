import { describe, expect, it } from 'vitest';
import { parseSingleElement } from './prd-table-parser.js';

describe('parseSingleElement', () => {
  it('純行內圖為 image', () => {
    expect(parseSingleElement('![配图](/a.png)')).toEqual({ type: 'image', src: '/a.png', alt: '配图' });
  });

  it('列表行且正文僅一張圖 → 獨立 image（與飛書對齊，不保留前綴）', () => {
    expect(parseSingleElement('    - ![alt](/prd/x.png)')).toEqual({ type: 'image', src: '/prd/x.png', alt: 'alt' });
    expect(parseSingleElement('  - ![]( /y.png )')).toEqual({ type: 'image', src: '/y.png' });
    expect(parseSingleElement('1. ![](/z.png)')).toEqual({ type: 'image', src: '/z.png' });
  });

  it('列表行含文字 + 圖仍為 text', () => {
    expect(parseSingleElement('  - 說明![](/x.png)')).toEqual({
      type: 'text',
      markdown: '  - 說明![](/x.png)',
    });
  });
});
