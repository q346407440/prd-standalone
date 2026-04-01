/**
 * tiptap-md-utils.js
 * Tiptap editor <-> Markdown 字串轉換工具。
 *
 * 依賴 tiptap-markdown extension（掛載後 editor.storage.markdown 可用）。
 */

/**
 * 從 Tiptap editor 取得 Markdown 字串。
 * @param {import('@tiptap/core').Editor} editor
 * @returns {string}
 */
export function editorToMarkdown(editor) {
  if (!editor?.storage?.markdown) return '';
  return editor.storage.markdown.getMarkdown();
}
