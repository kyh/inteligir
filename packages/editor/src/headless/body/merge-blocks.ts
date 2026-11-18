import { sameJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";

type BlockMerge =
  | { readonly kind: "merged"; readonly blocks: BodyBlock[] }
  | { readonly kind: "conflict"; readonly blockIds: string[] };

const idOf = ({ block }: BodyBlock) => block.id;

const idsIn = (bodies: readonly BodyBlock[], kept: Pick<ReadonlySet<string>, "has">) =>
  bodies.flatMap((body) => (kept.has(idOf(body)) ? [idOf(body)] : []));

const byId = (blocks: readonly BodyBlock[]) =>
  new Map(blocks.map((body) => [idOf(body), body])) satisfies Map<string, BodyBlock>;

const same = (a: BodyBlock, b: BodyBlock) => a.section === b.section && sameJson(a.block, b.block);

const settle = (
  base: BodyBlock | undefined,
  mine: BodyBlock | undefined,
  theirs: BodyBlock | undefined,
) => {
  if (mine !== undefined && theirs !== undefined) {
    if (same(mine, theirs)) {
      return mine;
    }

    if (base !== undefined && same(mine, base)) {
      return theirs;
    }

    return (base !== undefined && same(theirs, base) ? mine : "conflict") satisfies
      | BodyBlock
      | null
      | "conflict";
  }

  const kept = mine ?? theirs;

  if (kept === undefined) {
    return null;
  }

  return base !== undefined && same(kept, base) ? null : kept;
};

const keptOrder = (side: readonly BodyBlock[], base: readonly BodyBlock[]) => {
  const inSide = new Set(side.map(idOf));
  const inBase = new Set(base.map(idOf));
  const sideOrder = idsIn(side, inBase);
  const baseOrder = idsIn(base, inSide);

  return sideOrder.length === baseOrder.length && sideOrder.every((id, at) => id === baseOrder[at]);
};

const ordered = (
  first: readonly BodyBlock[],
  second: readonly BodyBlock[],
  merged: ReadonlyMap<string, BodyBlock>,
) => {
  const ids = idsIn(first, merged);
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

export const mergeBlocks = (
  base: readonly BodyBlock[],
  mine: readonly BodyBlock[],
  theirs: readonly BodyBlock[],
) => {
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
    return { blockIds, kind: "conflict" } satisfies BlockMerge;
  }

  const blocks =
    keptOrder(theirs, base) && !keptOrder(mine, base)
      ? ordered(mine, theirs, merged)
      : ordered(theirs, mine, merged);

  return { blocks, kind: "merged" } satisfies BlockMerge;
};
