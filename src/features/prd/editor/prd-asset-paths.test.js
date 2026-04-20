import { describe, it, expect } from 'vitest';
import { extractPrdImagePaths, isPrdImagePath, diffRemovedPrdPaths } from './prd-utils.js';
import { rewritePrdAssetPathsForNativeMd } from './prd-export-native-md.js';

describe('extractPrdImagePaths · 三格式识别', () => {
  it('识别旧 /prd/ 路径', () => {
    const md = '![](/prd/foo.png) and ![alt](/prd/bar.jpeg)';
    const set = extractPrdImagePaths(md);
    expect([...set].sort()).toEqual(['/prd/bar.jpeg', '/prd/foo.png']);
  });

  it('识别 colocated /pages/<slug>/assets/ 浏览器 URL', () => {
    const md = '![](/pages/doc-001/assets/a.png) ![](/pages/doc-007/assets/b.svg)';
    const set = extractPrdImagePaths(md);
    expect([...set].sort()).toEqual([
      '/pages/doc-001/assets/a.png',
      '/pages/doc-007/assets/b.svg',
    ]);
  });

  it('识别 ./assets/ 相对路径（行首与中段都算）', () => {
    const md = '![](./assets/x.png)\n\n参见 ![](./assets/y.webp)';
    const set = extractPrdImagePaths(md);
    expect([...set].sort()).toEqual(['./assets/x.png', './assets/y.webp']);
  });

  it('混合三种格式 + 大小写扩展名', () => {
    const md = [
      '![](/prd/legacy.PNG)',
      '![](/pages/doc-002/assets/colocated.JPG)',
      '![](./assets/relative.GIF)',
    ].join('\n');
    const set = extractPrdImagePaths(md);
    expect(set.size).toBe(3);
    expect(set.has('/prd/legacy.PNG')).toBe(true);
    expect(set.has('/pages/doc-002/assets/colocated.JPG')).toBe(true);
    expect(set.has('./assets/relative.GIF')).toBe(true);
  });

  it('跳过普通字符串（非图片扩展、非约定前缀）', () => {
    const md = 'see /prd/notes.md or ./assets/style.css or ./other/x.png';
    const set = extractPrdImagePaths(md);
    expect(set.size).toBe(0);
  });
});

describe('isPrdImagePath · 三格式判定', () => {
  it('合法路径', () => {
    expect(isPrdImagePath('/prd/x.png')).toBe(true);
    expect(isPrdImagePath('/pages/doc-001/assets/x.png')).toBe(true);
    expect(isPrdImagePath('./assets/x.png')).toBe(true);
    expect(isPrdImagePath('./assets/y.webp')).toBe(true);
  });

  it('非法路径', () => {
    expect(isPrdImagePath('/foo/x.png')).toBe(false);
    expect(isPrdImagePath('assets/x.png')).toBe(false); // 缺 ./
    expect(isPrdImagePath('/pages/X/assets/x.png')).toBe(false); // slug 必须 doc-数字
    expect(isPrdImagePath('/prd/x.md')).toBe(false); // 非图片
    expect(isPrdImagePath(null)).toBe(false);
    expect(isPrdImagePath(123)).toBe(false);
  });
});

describe('diffRemovedPrdPaths · 跨格式 diff', () => {
  it('删除 /prd/ 旧图、新增 ./assets/ 新图，应识别出旧图被移除', () => {
    const oldMd = '![](/prd/old.png)\n![](./assets/keep.png)';
    const newMd = '![](./assets/keep.png)\n![](./assets/new.png)';
    const removed = diffRemovedPrdPaths(oldMd, newMd);
    expect(removed).toEqual(['/prd/old.png']);
  });

  it('单纯改写路径（同文件名、不同前缀）会同时算「移除旧、新增新」', () => {
    // 这是迁移期的典型场景：./assets/x.png 实际指向同一磁盘文件 /prd/x.png，
    // 但 diff 不可能感知两者等价，删除清理逻辑要靠迁移脚本的兼容期保留磁盘文件来兜底。
    const oldMd = '![](/prd/x.png)';
    const newMd = '![](./assets/x.png)';
    const removed = diffRemovedPrdPaths(oldMd, newMd);
    expect(removed).toEqual(['/prd/x.png']);
  });
});

describe('rewritePrdAssetPathsForNativeMd · 导出规范化', () => {
  it('/pages/<slug>/assets/ → ./assets/', () => {
    const input = '![](/pages/doc-001/assets/a.png) ![](/pages/doc-009/assets/b.svg)';
    expect(rewritePrdAssetPathsForNativeMd(input))
      .toBe('![](./assets/a.png) ![](./assets/b.svg)');
  });

  it('/prd/ → ./assets/', () => {
    const input = '![](/prd/legacy.png)';
    expect(rewritePrdAssetPathsForNativeMd(input)).toBe('![](./assets/legacy.png)');
  });

  it('./assets/ 已规范化，不动', () => {
    const input = '![](./assets/x.png)';
    expect(rewritePrdAssetPathsForNativeMd(input)).toBe('![](./assets/x.png)');
  });

  it('混合输入', () => {
    const input = [
      '![](/prd/a.png)',
      '![](/pages/doc-003/assets/b.png)',
      '![](./assets/c.png)',
    ].join('\n');
    expect(rewritePrdAssetPathsForNativeMd(input)).toBe([
      '![](./assets/a.png)',
      '![](./assets/b.png)',
      '![](./assets/c.png)',
    ].join('\n'));
  });

  it('空字符串 / 非字符串 透传', () => {
    expect(rewritePrdAssetPathsForNativeMd('')).toBe('');
    expect(rewritePrdAssetPathsForNativeMd(null)).toBe(null);
    expect(rewritePrdAssetPathsForNativeMd(undefined)).toBe(undefined);
  });
});
