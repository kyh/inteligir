// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

// PATCHED: upstream runs these under bun:test; ported to vitest for this repo.
import { describe, expect, test } from 'vitest';
import { EditorState } from '@codemirror/state';
import { isInlineMathNode } from '../lib/markdown/mathMarkdown';

const stateWith = (doc: string) => EditorState.create({ doc });

describe('isInlineMathNode', () => {
  test('treats tight $...$ as inline', () => {
    const doc = 'x $a^2$ y';
    const state = stateWith(doc);
    expect(isInlineMathNode(state, 2, 7)).toBe(true);
  });

  test('treats padded $ ... $ as display', () => {
    const doc = 'x $ a $ y';
    const state = stateWith(doc);
    expect(isInlineMathNode(state, 2, 7)).toBe(false);
  });

  test('treats $$...$$ as display', () => {
    const doc = '$$x$$';
    const state = stateWith(doc);
    expect(isInlineMathNode(state, 0, 5)).toBe(false);
  });
});
