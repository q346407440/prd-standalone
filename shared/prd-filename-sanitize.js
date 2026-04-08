/**
 * PRD 文档主文件名（不含 .md）消毒：允许中文等 Unicode，禁止路径与系统保留字符。
 * 供 server 与前端共用，规则须保持一致。
 */

/** 主文件名最大长度（按 Unicode 码点计） */
export const MAX_DOC_BASE_LEN = 80;

const ILLEGAL_FILE_CHARS = /[\\/:*?"<>|]/g;

/** 零宽字符与 BOM */
const INVISIBLE = /[\u200B-\u200D\uFEFF]/g;

/** 去掉 C0 控制符与 DEL，避免路径与终端异常 */
function stripControlCharacters(s) {
  return [...s].filter((ch) => {
    const cp = ch.codePointAt(0);
    return cp >= 0x20 && cp !== 0x7f;
  }).join('');
}

const WIN_RESERVED = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * @param {unknown} name
 * @returns {string} 合法则返回非空字符串，否则返回 ''
 */
export function toSafeDocBaseName(name) {
  let s = String(name ?? '').normalize('NFC').trim();
  s = stripControlCharacters(s);
  s = s.replace(ILLEGAL_FILE_CHARS, '');
  s = s.replace(INVISIBLE, '');
  s = s.trim();
  if (!s || s === '.' || s === '..' || /[/\\]/.test(s)) return '';
  s = s.replace(/^[\s.]+/g, '').replace(/[\s.]+$/g, '');
  if (!s || s === '.' || s === '..') return '';
  const chars = [...s];
  if (chars.length > MAX_DOC_BASE_LEN) {
    s = chars.slice(0, MAX_DOC_BASE_LEN).join('');
  }
  if (WIN_RESERVED.test(s)) {
    s = `${s}_文档`;
  }
  return s;
}
