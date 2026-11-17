// A body saved over a version someone else saved first, merged by block id: the blocks the save
// was made over, the blocks it holds, and the blocks saved since. A block only one side changed
// takes that side's; one both changed alike is that; one both changed apart is a conflict, which
// lands nothing, so no one's words vanish. An edit beats a drop, and a section rides with its block.

import { sameJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";

export type BlockMerge =
  | { readonly kind: "merged"; readonly blocks: BodyBlock[] }
  | { readonly kind: "conflict"; readonly blockIds: string[] };

const idOf = ({ block }: BodyBlock): string => block.id;

const byId = (blocks: readonly BodyBlock[]): Map<string, BodyBlock> =>
  new Map(blocks.map((body) => [idOf(body), body]));

const same = (a: BodyBlock, b: BodyBlock): boolean =>
  a.section === b.section && sameJson(a.block, b.block);

// What a block becomes, `null` for gone: `base` as the save read it, `mine` and `theirs` each side's
// (undefined where that side holds none).
const settle = (
  base: BodyBlock | undefined,
  mine: BodyBlock | undefined,
  theirs: BodyBlock | undefined,
): BodyBlock | null | "conflict" => {
  if (mine !== undefined && theirs !== undefined) {
    if (same(mine, theirs)) {
      return mine;
    }
    if (base !== undefined && same(mine, base)) {
      return theirs;
    }
    return base !== undefined && same(theirs, base) ? mine : "conflict";
  }
  const kept = mine ?? theirs;
  if (kept === undefined) {
    return null;
  }
  // one side dropped it: gone, unless the other changed it since, or made it
  return base !== undefined && same(kept, base) ? null : kept;
};

// whether `side` holds the blocks it shares with `base` in base's order, having moved none
const keptOrder = (side: readonly BodyBlock[], base: readonly BodyBlock[]): boolean => {
  const inSide = new Set(side.map(idOf));
  const inBase = new Set(base.map(idOf));
  const sideOrder = side.map(idOf).filter((id) => inBase.has(id));
  const baseOrder = base.map(idOf).filter((id) => inSide.has(id));
  return sideOrder.length === baseOrder.length && sideOrder.every((id, at) => id === baseOrder[at]);
};

// `first`'s order, each block of `second` it lacks placed after the nearest block before it in
// `second` that is placed, or at the top
const ordered = (
  first: readonly BodyBlock[],
  second: readonly BodyBlock[],
  merged: ReadonlyMap<string, BodyBlock>,
): BodyBlock[] => {
  const ids = first.map(idOf).filter((id) => merged.has(id));
  const placed = new Set(ids);
  for (const [index, body] of second.entries()) {
    const id = idOf(body);
    if (merged.has(id) && !placed.has(id)) {
      const after = second.slice(0, index).findLast((before) => placed.has(idOf(before)));
      ids.splice(after === undefined ? 0 : ids.indexOf(idOf(after)) + 1, 0, id);
      placed.add(id);
    }
  }
  return ids.flatMap((id) => merged.get(id) ?? []);
};

// The order is theirs, unless only mine moved blocks, so neither side's move is lost to an edit
// elsewhere; when both moved, theirs stands.
export const mergeBlocks = (
  base: readonly BodyBlock[],
  mine: readonly BodyBlock[],
  theirs: readonly BodyBlock[],
): BlockMerge => {
  const was = byId(base);
  const ours = byId(mine);
  const others = byId(theirs);
  const merged = new Map<string, BodyBlock>();
  const blockIds: string[] = [];
  for (const id of new Set([...ours.keys(), ...others.keys()])) {
    const settled = settle(was.get(id), ours.get(id), others.get(id));
    if (settled === "conflict") {
      blockIds.push(id);
    } else if (settled !== null) {
      merged.set(id, settled);
    }
  }
  if (blockIds.length > 0) {
    return { blockIds, kind: "conflict" };
  }
  const blocks =
    keptOrder(theirs, base) && !keptOrder(mine, base)
      ? ordered(mine, theirs, merged)
      : ordered(theirs, mine, merged);
  return { blocks, kind: "merged" };
};
