import markdownit from 'markdown-it';
import { parseListPrefix } from './prd-list-utils.js';

const md = markdownit({ html: false, linkify: false, breaks: false });
md.renderer.rules.link_open = (tokens, idx, options, env, self) => {
  const token = tokens[idx];
  const href = token.attrGet('href') || '';
  return `<a href="${href}" class="prd-md-link" target="_blank" rel="noreferrer noopener">`;
};
md.renderer.rules.image = (tokens, idx) => {
  const token = tokens[idx];
  const src = token.attrGet('src') || '';
  const alt = token.content || '';
  const title = token.attrGet('title');
  const titleAttr = title ? ` title="${md.utils.escapeHtml(title)}"` : '';
  return `<img class="prd-md-preview-img" src="${md.utils.escapeHtml(src)}" alt="${md.utils.escapeHtml(alt)}"${titleAttr} />`;
};

/**
 * 列表行預覽：與編輯態 hanging indent 一致——符號與正文分欄 flex，換行後續行對齊正文左緣，
 * 不可再用「行內 span + 正文」否則換行會貼齊容器左側。
 */
function renderListLinePreviewHtml(parsed) {
  if (!parsed) return '';
  const indentLevel = Math.floor(parsed.indent.length / 2);
  const isBullet = /^[-*+]$/.test(parsed.marker);
  const markerChar = isBullet ? '•' : parsed.marker;
  const pad = indentLevel * 16;
  const body = md.renderInline(parsed.body);
  const markerEsc = md.utils.escapeHtml(markerChar);
  const classes = ['prd-md-preview-list-line'];
  if (!isBullet) classes.push('prd-md-preview-list-line--ordered');
  if (isBullet && indentLevel === 0) {
    return `<div class="prd-md-preview-list-line--root-bullet"><span class="prd-md-preview-list-line__body">${body}</span></div>`;
  }
  return `<div class="${classes.join(' ')}" style="padding-left:${pad}px"><span class="prd-md-preview-list-line__marker">${markerEsc}</span><span class="prd-md-preview-list-line__body">${body}</span></div>`;
}

/**
 * 段落預覽：與編輯態（markdown 前綴列表、無 ul 節點）對齊。
 * - 空白段（\n\n）→ 多個段落塊，段間留白與原 `<br /><br />` 相近
 * - 列表行：flex hanging indent（見 renderListLinePreviewHtml）
 * - 純文字行：塊級行容器，與列表行同層堆疊
 */
export function renderParagraphMarkdownPreviewToHtml(raw) {
  if (raw == null || !String(raw).trim()) return '';
  const text = String(raw);
  const paragraphs = text.split(/\n\n+/).map((p) => p.trimEnd()).filter((p) => p.trim());
  return paragraphs
    .map((para) => {
      const lines = para
        .split(/\n/)
        .map((line) => {
          const trimmed = line.trimEnd();
          if (!trimmed.trim()) return '';
          const parsed = parseListPrefix(trimmed);
          if (parsed) {
            return renderListLinePreviewHtml(parsed);
          }
          return `<div class="prd-md-preview-line prd-md-preview-line--text">${md.renderInline(trimmed)}</div>`;
        })
        .filter(Boolean);
      return `<div class="prd-md-preview-para">${lines.join('')}</div>`;
    })
    .join('');
}
