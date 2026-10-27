// Items, blocks and ops for the library model's suites, built by hand or drawn from the package's
// one seeded generator (`./seeded-random`), so a failing case reruns from its seed.

import { blockHash } from "../library/block-hash";
import { applyOps, orderedBlocks } from "../library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "../library/block-ops";
import { ordBetween, ordsBetween } from "../library/block-order";
import type { LibraryItemFields } from "../library/library-item";
import type { LibraryBlock, LibrarySection } from "../library/library-nodes";
import { pick } from "./seeded-random";

export const noteFields = (overrides: Partial<LibraryItemFields> = {}): LibraryItemFields => ({
  aliases: [],
  author: null,
  copySha: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "A note",
  url: null,
  ...overrides,
});

export const paragraph = (id: string, text: string): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const stored = (
  block: LibraryBlock,
  ord: string,
  section: LibrarySection = "note",
): StoredBlock => ({ block, hash: blockHash(block), ord, section });

// an item whose blocks sit in the order given, keyed as the library mints keys
export const itemOf = (
  blocks: readonly LibraryBlock[],
  fields: LibraryItemFields = noteFields(),
  section: LibrarySection = "note",
): ItemState => {
  const keys = ordsBetween(null, null, blocks.length);
  return {
    blocks: new Map(
      blocks.map((block, index) => [block.id, stored(block, keys[index] ?? "a0", section)]),
    ),
    fields,
  };
};

// the item's blocks as `id:text` lines in reading order: one line per block, as revert-edit reads
// a file
export const renderLines = (state: ItemState): string =>
  orderedBlocks(state.blocks)
    .map(({ block }) => {
      const [leaf] = block.children;
      return `${block.id}:${leaf !== undefined && "text" in leaf ? leaf.text : ""}`;
    })
    .join("\n");

export const landed = (state: ItemState, ops: readonly LibraryOp[]): ItemState => {
  const outcome = applyOps(state, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`ops did not land: ${JSON.stringify(outcome)}`);
  }
  return outcome.state;
};

const WORDS = ["alpha", "beta", "gamma", "delta", "epsilon", "zeta", "eta", "theta"] as const;

const randomText = (rand: () => number): string =>
  Array.from({ length: 1 + Math.floor(rand() * 4) }, () => pick(rand, WORDS)).join(" ");

export const randomItem = (rand: () => number, prefix: string, count: number): ItemState =>
  itemOf(
    Array.from({ length: count }, (_, index) =>
      paragraph(`${prefix}${String(index)}`, randomText(rand)),
    ),
  );

// the key that puts a block just after `after` (null: at the start) in `state`'s reading order
const keyAfter = (state: ItemState, after: string | null, skip: string | null): string => {
  const order = orderedBlocks(state.blocks).filter(({ block }) => block.id !== skip);
  const at = after === null ? -1 : order.findIndex(({ block }) => block.id === after);
  return ordBetween(order[at]?.ord ?? null, order[at + 1]?.ord ?? null);
};

export interface BatchOptions {
  // whether the writer moves blocks as well as writing them
  readonly moves: boolean;
}

const MOVING: BatchOptions = { moves: true };

// one valid op over a block `owned` lets this writer touch, or a new block it names `fresh`
const randomBlockOp = (
  rand: () => number,
  state: ItemState,
  owned: readonly string[],
  fresh: string,
  options: BatchOptions,
): LibraryOp => {
  const present = owned.filter((id) => state.blocks.has(id));
  const choice = rand();
  const target = present.length === 0 ? undefined : pick(rand, present);
  const held = target === undefined ? undefined : state.blocks.get(target);
  if (choice < 0.25 || held === undefined) {
    const others = orderedBlocks(state.blocks).map(({ block }) => block.id);
    const after = others.length === 0 || rand() < 0.2 ? null : pick(rand, others);
    return {
      block: paragraph(fresh, randomText(rand)),
      op: "insert",
      ord: keyAfter(state, after, null),
      section: "note",
    };
  }
  if (choice < 0.6) {
    return {
      baseHash: held.hash,
      block: paragraph(held.block.id, randomText(rand)),
      op: "put",
    };
  }
  if (choice < 0.8 || !options.moves) {
    return { baseHash: held.hash, blockId: held.block.id, op: "drop" };
  }
  const others = orderedBlocks(state.blocks)
    .map(({ block }) => block.id)
    .filter((id) => id !== held.block.id);
  const after = others.length === 0 || rand() < 0.2 ? null : pick(rand, others);
  return {
    baseOrd: held.ord,
    blockId: held.block.id,
    op: "move",
    ord: keyAfter(state, after, held.block.id),
  };
};

export interface WriterBatch {
  readonly ops: LibraryOp[];
  // the item once the batch lands
  readonly state: ItemState;
}

// a writer's batch: each op drawn against the item as the ones before it left it, every block op
// on a block of `owned` or one it inserts
export const randomBlockOps = (
  rand: () => number,
  state: ItemState,
  owned: readonly string[],
  prefix: string,
  count: number,
  options: BatchOptions = MOVING,
): WriterBatch => {
  const ops: LibraryOp[] = [];
  let next = state;
  const mine = [...owned];
  for (let index = 0; index < count; index += 1) {
    const fresh = `${prefix}${String(index)}`;
    const op = randomBlockOp(rand, next, mine, fresh, options);
    if (op.op === "insert") {
      mine.push(fresh);
    }
    ops.push(op);
    next = landed(next, [op]);
  }
  return { ops, state: next };
};
