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
    expect(splitMarkdownByInlineImages('![配图说明](/prd/a.png)')).toEqual([
      { type: 'image', src: '/prd/a.png', alt: '配图说明' },
    ]);
  });

  it('前文 + 圖 + 後文', () => {
    expect(splitMarkdownByInlineImages('前![图注](/x.png)後')).toEqual([
      { type: 'text', markdown: '前' },
      { type: 'image', src: '/x.png', alt: '图注' },
      { type: 'text', markdown: '後' },
    ]);
  });

  it('同段兩張圖依序拆分', () => {
    expect(splitMarkdownByInlineImages('a![一号图](/1.png)b![二号图](/2.png)c')).toEqual([
      { type: 'text', markdown: 'a' },
      { type: 'image', src: '/1.png', alt: '一号图' },
      { type: 'text', markdown: 'b' },
      { type: 'image', src: '/2.png', alt: '二号图' },
      { type: 'text', markdown: 'c' },
    ]);
  });

  it('圖片 URL 去首尾空白', () => {
    expect(splitMarkdownByInlineImages('![]( /y.png )')).toEqual([{ type: 'image', src: '/y.png' }]);
  });

  it('多行僅圖：換行分隔不產生空白 text（避免格內空編輯塊與佔位符）', () => {
    expect(splitMarkdownByInlineImages('![](/a.png)\n![](/b.png)')).toEqual([
      { type: 'image', src: '/a.png' },
      { type: 'image', src: '/b.png' },
    ]);
    expect(splitMarkdownByInlineImages('![](/a.png)\n\n![](/b.png)')).toEqual([
      { type: 'image', src: '/a.png' },
      { type: 'image', src: '/b.png' },
    ]);
  });

  it('列表行含行內圖不拆（避免格內預覽斷成「僅前綴 + 獨立圖」）', () => {
    expect(splitMarkdownByInlineImages('    - ![alt](/prd/a.png)')).toEqual([
      { type: 'text', markdown: '    - ![alt](/prd/a.png)' },
    ]);
    expect(splitMarkdownByInlineImages('  - 說明![](/x.png)')).toEqual([
      { type: 'text', markdown: '  - 說明![](/x.png)' },
    ]);
  });
});

describe('cellFromMarkdownString', () => {
  it('包成 elements 陣列', () => {
    expect(cellFromMarkdownString('x![说明](/z.png)y')).toEqual({
      elements: [
        { type: 'text', markdown: 'x' },
        { type: 'image', src: '/z.png', alt: '说明' },
        { type: 'text', markdown: 'y' },
      ],
    });
  });
});
