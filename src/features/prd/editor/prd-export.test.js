import JSZip from 'jszip';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePrd } from './prd-parser.js';
import { buildNativeMdPrdExport } from './prd-export.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildNativeMdPrdExport', () => {
  it('导出的原生 MD 压缩包固定使用 prd.md 和 prd-assets', async () => {
    const blocks = parsePrd([
      '<!-- block:paragraph -->',
      '![示意图](./assets/demo.png)',
      '',
    ].join('\n'));

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      blob: async () => new Uint8Array([1, 2, 3]),
    })));

    const result = await buildNativeMdPrdExport({
      title: '会员弹窗需求',
      archiveName: '会员弹窗需求-导出包',
      blocks,
      activeSlug: 'doc-001',
      mdPath: '/pages/doc-001/Loyalty弹窗需求.md',
    });

    const zip = await JSZip.loadAsync(await result.blob.arrayBuffer());
    const fileNames = Object.keys(zip.files).sort();
    const mdText = await zip.file('prd.md').async('string');

    expect(result.fileName).toBe('会员弹窗需求-导出包.zip');
    expect(result.mdFileName).toBe('prd.md');
    expect(fileNames).toEqual(['prd-assets/', 'prd-assets/demo.png', 'prd.md']);
    expect(mdText).toContain('![示意图](./prd-assets/demo.png)');
  });
});
