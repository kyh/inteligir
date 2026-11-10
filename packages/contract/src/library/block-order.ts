// Where a block sits in its item: an order key (`./order-key.ts`), so an insert or a move names a
// key between its neighbours and renumbers nothing. Items read in section order, note before
// article, then by key, then by id, since two devices inserting between the same neighbours can
// mint the same key.

import type { LibrarySection } from "./library-nodes";
import { compareText, ordsBetween } from "./order-key";

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
/** @internal */
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
