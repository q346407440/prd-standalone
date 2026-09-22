import { describe, expect, it } from 'vitest';
import { globalSelectionForDuplicatedBlock } from './prd-block-operations.js';

describe('globalSelectionForDuplicatedBlock', () => {
  it('标题与段落文本', () => {
    expect(globalSelectionForDuplicatedBlock({
      id: 'a',
      type: 'h2',
      content: { type: 'text', markdown: 'x' },
    })).toEqual({
      type: 'text-block', blockId: 'a', role: 'heading', cellPath: null,
    });
    expect(globalSelectionForDuplicatedBlock({
      id: 'b',
      type: 'paragraph',
      content: { type: 'text', markdown: 'y' },
    })).toEqual({
      type: 'text-block', blockId: 'b', role: 'paragraph', cellPath: null,
    });
  });

  it('段落图与图表', () => {
    expect(globalSelectionForDuplicatedBlock({
      id: 'c',
      type: 'paragraph',
      content: { type: 'image', src: '/x.png' },
    })).toEqual({ type: 'image', blockId: 'c', cellPath: null });
    expect(globalSelectionForDuplicatedBlock({
      id: 'd',
      type: 'mermaid',
      content: { type: 'mermaid', code: 'x' },
    })).toEqual({ type: 'diagram', blockId: 'd' });
    expect(globalSelectionForDuplicatedBlock({
      id: 'e',
      type: 'mindmap',
      content: { type: 'mindmap', code: 'y' },
    })).toEqual({ type: 'diagram', blockId: 'e' });
  });

  it('divider / table 返回 null', () => {
    expect(globalSelectionForDuplicatedBlock({
      id: 'f',
      type: 'divider',
      content: { type: 'divider' },
    })).toBeNull();
    expect(globalSelectionForDuplicatedBlock({
      id: 'g',
      type: 'table',
      content: { type: 'table', headers: ['A'], rows: [] },
    })).toBeNull();
  });
});
