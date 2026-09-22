import { createContext, useContext } from 'react';

/**
 * 供 Tiptap 选区气泡等深层组件调用，与块 actionbar / 表格格内「复制路径与片段」共用同一套剪贴板逻辑。
 * @typedef {{ copyPathAndSnippet: (snippet: string) => void }} PrdCopyPathSnippetApi
 */

/** @type {import('react').Context<PrdCopyPathSnippetApi | null>} */
export const PrdCopyPathSnippetContext = createContext(null);

export function usePrdCopyPathSnippet() {
  return useContext(PrdCopyPathSnippetContext);
}
