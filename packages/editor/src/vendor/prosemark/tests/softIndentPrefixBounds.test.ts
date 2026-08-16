// Vendored from ProseMark (github.com/jsimonrichard/ProseMark), MIT.
// (c) J. Simon Richard. See PROVENANCE.md for the pinned commit and local patches.

// PATCHED: upstream runs these under bun:test; ported to vitest for this repo.
import { describe, expect, test } from 'vitest';
import { softIndentPrefixBounds } from '../lib/softIndentExtension';

describe('softIndentPrefixBounds', () => {
  test('places bodyStartPos after the prefix and prefixEndPos on its last character', () => {
    const lineFrom = 100;
    const prefix = '- ';
    const bounds = softIndentPrefixBounds(lineFrom, prefix);

    expect(bounds).toEqual({
      lineFrom,
      prefix,
      prefixEndPos: lineFrom + prefix.length - 1,
      bodyStartPos: lineFrom + prefix.length,
    });
  });

  test('keeps prefixEndPos at line start when prefix is empty', () => {
    const bounds = softIndentPrefixBounds(50, '');
    expect(bounds.prefixEndPos).toBe(50);
    expect(bounds.bodyStartPos).toBe(50);
  });
});
