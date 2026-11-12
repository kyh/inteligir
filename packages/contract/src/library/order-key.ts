// A fractional order key (rocicorp/fractional-indexing, the classic base-62 keys with A–Z/a–z
// heads), so placing something between two neighbours names a key between theirs and renumbers
// nothing: a folder's sort among its siblings and a block's place in its item.

import { generateKeyBetween } from "fractional-indexing";
import { z } from "zod";

// a key grows by about one character per halving of the gap it lands in; past this a writer is
// splitting one gap forever, and the cell refuses rather than store it
const ORD_MAX_LENGTH = 128;

const BASE_62_KEY = /^[0-9A-Za-z]+$/u;
const NEGATIVE_HEADS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const POSITIVE_HEADS = "abcdefghijklmnopqrstuvwxyz";
const HEAD_COUNT = 26;
const SHORTEST_INTEGER = 2;
const SMALLEST_KEY = `A${"0".repeat(HEAD_COUNT)}`;

// the integer part's length its head announces (the library's own reading of a key), or null for
// a head outside both alphabets
const integerLength = (head: string): number | null => {
  const positive = POSITIVE_HEADS.indexOf(head);
  if (positive !== -1) {
    return positive + SHORTEST_INTEGER;
  }
  const negative = NEGATIVE_HEADS.indexOf(head);
  return negative === -1 ? null : HEAD_COUNT - negative + 1;
};

// what generateKeyBetween accepts as a bound: a head, as many integer digits as it announces, and
// a fraction that never ends in the zero digit. The library checks the head and the zero alone,
// so the digits are held to the alphabet here.
export const isOrdKey = (key: string): boolean => {
  if (key.length === 0 || key.length > ORD_MAX_LENGTH || key === SMALLEST_KEY) {
    return false;
  }
  const length = integerLength(key.slice(0, 1));
  if (length === null || length > key.length) {
    return false;
  }
  // a fraction ending in the zero digit has a shorter spelling, which is the one the library mints
  if (key.length > length && key.endsWith("0")) {
    return false;
  }
  return BASE_62_KEY.test(key);
};

export const ordSchema = z.string().refine(isOrdKey, { error: "is not an order key" });

// a key after `before` and ahead of `after` (null: the start or the end)
export const ordBetween = (before: string | null, after: string | null): string =>
  generateKeyBetween(before, after);

// code-unit order, the order fractional keys are minted in and SQLite's BINARY collation reads
export const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};
