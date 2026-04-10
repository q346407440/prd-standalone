import { describe, expect, it } from 'vitest';
import { cellFromMarkdownString, splitMarkdownByInlineImages } from './prd-inline-image-split.js';

describe('splitMarkdownByInlineImages', () => {
  it('空字串為單一 text', () => {
    expect(splitMarkdownByInlineImages('')).toEqual([{ type: 'text', markdown: '' }]);
  });

  it('無圖片語法為單一 text', () => {
    expect(splitMarkdownByInlineImages('僅文字')).toEqual([{ type: 'text', markdown: '僅文字' }]);
  });

  it('整段僅圖片為單一 image', () => {
    expect(splitMarkdownByInlineImages('![](/prd/a.png)')).toEqual([
      { type: 'image', src: '/prd/a.png' },
    ]);
  });

  it('前文 + 圖 + 後文', () => {
    expect(splitMarkdownByInlineImages('前![](/x.png)後')).toEqual([
      { type: 'text', markdown: '前' },
      { type: 'image', src: '/x.png' },
      { type: 'text', markdown: '後' },
    ]);
  });

  it('同段兩張圖依序拆分', () => {
    expect(splitMarkdownByInlineImages('a![](/1.png)b![](/2.png)c')).toEqual([
      { type: 'text', markdown: 'a' },
      { type: 'image', src: '/1.png' },
      { type: 'text', markdown: 'b' },
      { type: 'image', src: '/2.png' },
      { type: 'text', markdown: 'c' },
    ]);
  });

  it('圖片 URL 去首尾空白', () => {
    expect(splitMarkdownByInlineImages('![]( /y.png )')).toEqual([{ type: 'image', src: '/y.png' }]);
  });
});

describe('cellFromMarkdownString', () => {
  it('包成 elements 陣列', () => {
    expect(cellFromMarkdownString('x![](/z.png)y')).toEqual({
      elements: [
        { type: 'text', markdown: 'x' },
        { type: 'image', src: '/z.png' },
        { type: 'text', markdown: 'y' },
      ],
    });
  });
});
