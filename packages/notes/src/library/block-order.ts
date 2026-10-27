// Where a block sits in its item: a fractional order key (rocicorp/fractional-indexing, the classic
// base-62 keys with A–Z/a–z heads), so an insert or a move names a key between its neighbours and
// renumbers nothing. Items read in section order, note before article, then by key, then by id,
// since two devices inserting between the same neighbours can mint the same key.

import { generateKeyBetween, generateNKeysBetween } from "fractional-indexing";
import { z } from "zod";

import type { LibrarySection } from "./library-nodes";

// a key grows by about one character per halving of the gap it lands in; past this a writer is
// splitting one gap forever, and the cell refuses rather than store it
export const ORD_MAX_LENGTH = 128;

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

// `count` keys spread evenly between two neighbours, shorter than minting them one by one
export const ordsBetween = (before: string | null, after: string | null, count: number): string[] =>
  generateNKeysBetween(before, after, count);

// code-unit order, the order fractional keys are minted in and SQLite's BINARY collation reads
export const compareText = (a: string, b: string): number => {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
};

const SECTION_RANK = { article: 1, note: 0 } satisfies Record<LibrarySection, number>;

export interface BlockPlace {
  readonly blockId: string;
  readonly ord: string;
  readonly section: LibrarySection;
}

export const compareBlockPlaces = (a: BlockPlace, b: BlockPlace): number =>
  SECTION_RANK[a.section] - SECTION_RANK[b.section] ||
  compareText(a.ord, b.ord) ||
  compareText(a.blockId, b.blockId);

// the longest run of `order` whose keys strictly increase, by patience sorting: the positions it
// keeps
const increasingRun = (keys: readonly (string | undefined)[]): Set<number> => {
  // tails[k]: the position ending the best run of length k + 1 found so far
  const tails: number[] = [];
  const previous = new Map<number, number>();
  for (const [position, key] of keys.entries()) {
    if (key === undefined) {
      continue;
    }
    let low = 0;
    let high = tails.length;
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      const at = keys[tails[middle] ?? -1];
      if (at !== undefined && at < key) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    const before = tails[low - 1];
    if (before !== undefined) {
      previous.set(position, before);
    }
    tails[low] = position;
  }
  const kept = new Set<number>();
  for (let at = tails.at(-1); at !== undefined; at = previous.get(at)) {
    kept.add(at);
  }
  return kept;
};

// keys for `order`, keeping the longest increasing run of `primary`'s and filling each gap with
// `secondary`'s key where it still fits, else fresh keys between the neighbours that do
const assignKeys = (
  order: readonly string[],
  primary: ReadonlyMap<string, string>,
  secondary: ReadonlyMap<string, string>,
): Map<string, string> => {
  const keys = order.map((id) => primary.get(id));
  const fixed = increasingRun(keys);
  const assigned = new Map<string, string>();
  let lower: string | null = null;
  let pending: string[] = [];
  const settle = (upper: string | null): void => {
    if (pending.length > 0) {
      for (const [index, key] of ordsBetween(lower, upper, pending.length).entries()) {
        const id = pending[index];
        if (id !== undefined) {
          assigned.set(id, key);
        }
      }
    }
    pending = [];
  };
  const upperBound = (from: number): string | null => {
    for (let position = from; position < order.length; position += 1) {
      const key = keys[position];
      if (fixed.has(position) && key !== undefined) {
        return key;
      }
    }
    return null;
  };
  for (const [position, id] of order.entries()) {
    const key = keys[position];
    if (fixed.has(position) && key !== undefined) {
      settle(key);
      assigned.set(id, key);
      lower = key;
      continue;
    }
    const fallback = secondary.get(id);
    const upper = upperBound(position + 1);
    const fits =
      fallback !== undefined &&
      (lower === null || lower < fallback) &&
      (upper === null || fallback < upper);
    if (fits) {
      settle(fallback);
      assigned.set(id, fallback);
      lower = fallback;
    } else {
      pending.push(id);
    }
  }
  settle(null);
  return assigned;
};

// Keys that put one section's blocks in `order`. When every block can take back the key it had
// (`restore`) or keep the one it holds, that is the answer, so taking a change back with nothing
// done since lands every block on the key it had. Otherwise the answer that moves fewer blocks
// wins: the blocks in place stay and the rest find room (a block coming back takes its old key if
// it still fits), or the old keys come back and the rest find room around them.
export const placeInOrder = (
  order: readonly string[],
  current: ReadonlyMap<string, string>,
  restore: ReadonlyMap<string, string>,
): Map<string, string> => {
  const restoring = assignKeys(order, restore, current);
  const ownKeys = order.every((id) => {
    const key = restoring.get(id);
    return key === restore.get(id) || key === current.get(id);
  });
  if (ownKeys) {
    return restoring;
  }
  const keeping = assignKeys(order, current, restore);
  const moves = (keys: ReadonlyMap<string, string>): number =>
    order.filter((id) => keys.get(id) !== current.get(id)).length;
  return moves(restoring) < moves(keeping) ? restoring : keeping;
};
