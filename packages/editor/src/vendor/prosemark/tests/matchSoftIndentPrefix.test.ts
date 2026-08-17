// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

// PATCHED: upstream runs these under bun:test; ported to vitest for this repo.
import { describe, expect, test } from 'vitest';
import { matchSoftIndentPrefix } from '../lib/softIndentExtension';

describe('matchSoftIndentPrefix', () => {
  test('matches list and blockquote prefixes', () => {
    expect(matchSoftIndentPrefix('- item')).toBe('- ');
    expect(matchSoftIndentPrefix('  - nested')).toBe('  - ');
    expect(matchSoftIndentPrefix('> quote')).toBe('> ');
    expect(matchSoftIndentPrefix('    indented')).toBe('    ');
    expect(matchSoftIndentPrefix('1. ordered')).toBe('1. ');
    expect(matchSoftIndentPrefix('- [x] task')).toBe('- [x] ');
  });

  test('does not match plain paragraphs (with or without math)', () => {
    expect(matchSoftIndentPrefix('Plain paragraph')).toBeNull();
    expect(matchSoftIndentPrefix('Inline $x^2$ in prose')).toBeNull();
    expect(matchSoftIndentPrefix('$x$ at start')).toBeNull();
  });
});
