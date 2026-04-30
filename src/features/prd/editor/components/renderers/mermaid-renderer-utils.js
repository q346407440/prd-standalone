let mermaidInitialized = false;
let mermaidLibPromise = null;
let mermaidRenderSeq = 0;

export async function getMermaidLib() {
  if (!mermaidLibPromise) {
    mermaidLibPromise = import('mermaid').then((mod) => mod.default || mod);
  }
  const mermaidLib = await mermaidLibPromise;
  if (mermaidInitialized) return mermaidLib;
  mermaidInitialized = true;
  mermaidLib.initialize({
    startOnLoad: false,
    theme: 'default',
    securityLevel: 'strict',
    fontFamily: 'inherit',
    /** 流程图节点用 HTML 标签 + wrappingWidth，才能按「宽度」自动折行，避免长文案被方框裁切。 */
    htmlLabels: true,
    flowchart: {
      useMaxWidth: true,
      /** 节点内折行时的参考行宽（px），与 Mermaid 默认走同一套排字逻辑。 */
      wrappingWidth: 200,
    },
  });
  return mermaidLib;
}

export function convertMermaidMindmapToMarkdown(code) {
  const MERMAID_MINDMAP_RE = /^mindmap\s*\n/;
  if (!MERMAID_MINDMAP_RE.test(code)) return null;
  const lines = code.split('\n').slice(1);
  if (!lines.length) return '';

  const SHAPE_RE = /^(.*?)(?:\(\(([^)]*)\)\)|\(([^)]*)\)|\[([^\]]*)\]|\{([^}]*)\})(.*)$/;

  let rootIndent = -1;
  const result = [];

  for (const rawLine of lines) {
    if (!rawLine.trim()) continue;
    const spaces = rawLine.match(/^(\s*)/)[1].length;
    let text = rawLine.trim();

    if (rootIndent < 0) {
      rootIndent = spaces;
    }

    const shapeMatch = text.match(SHAPE_RE);
    if (shapeMatch) {
      text = (shapeMatch[1] + (shapeMatch[2] ?? shapeMatch[3] ?? shapeMatch[4] ?? shapeMatch[5] ?? '') + shapeMatch[6]).trim();
    }

    const depth = Math.max(0, spaces - rootIndent);
    const indent = '  '.repeat(depth);
    result.push(`${indent}- ${text}`);
  }

  return result.join('\n');
}

export function waitForNextAnimationFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

export function estimateMermaidTextareaRows(code) {
  const text = code || '';
  const newlineRows = Math.max(text.split('\n').length, 1);
  if (!text.includes(';')) {
    return Math.min(60, Math.max(newlineRows, 4));
  }
  const stmtApprox = Math.max(
    text.split(';').filter((s) => s.trim().length > 0).length,
    1,
  );
  return Math.min(60, Math.max(newlineRows, stmtApprox, 4));
}

export async function renderMermaidSvgForExport(code) {
  const currentCode = (code || '').trim();
  if (!currentCode) {
    return { svgHtml: '', error: 'Mermaid 代码为空' };
  }
  try {
    const mermaidLib = await getMermaidLib();
    const renderKey = `mermaid-export-${Date.now()}-${++mermaidRenderSeq}`;
    const { svg } = await mermaidLib.render(renderKey, currentCode);
    return { svgHtml: svg, error: '' };
  } catch (error) {
    return { svgHtml: '', error: String(error?.message || error) };
  }
}
