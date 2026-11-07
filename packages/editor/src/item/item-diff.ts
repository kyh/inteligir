// What an item's editor value changed since the blocks it was last acknowledged at, as the ops the
// library lands: every top-level element is a block under the id Plate gave it (its nodeId), and a
// block is decided by its hash, never by whether its object changed, since an edit undone or a
// paste of the same words is a new object holding the same block. An id the value no longer holds
// is a drop and one the acknowledged blocks never held an insert, so an id Plate minted again is a
// drop and an insert; a block keeps its section, its order key where it still fits among its
// neighbours, and takes a fresh key between them where it does not. The ids Plate gives the
// elements inside a block are the editor's own (a table's cells are keyed by them) and no block
// stores one, so a block laid in from elsewhere, which Plate names again inside, hashes as it was
// stored. An element no block can store is held back, and its acknowledged block left as it stands.
// A picker open in a block is read around, since its query is nobody's writing yet.

import { ElementApi } from "platejs";
import type { Descendant, TElement } from "platejs";

import { blockHash } from "@repo/notes/library/block-hash";
import type { LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { placeInOrder } from "@repo/notes/library/block-order";
import { blockIdSchema, storableBlockSchema } from "@repo/notes/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";

import { PICKER_INPUT_TYPES } from "@repo/editor/combobox-input";
import { stringProp } from "@repo/editor/node-props";
import { namedBlockJson, tidyBlock } from "../codec/read-blocks";

// one top-level element as the block it stores, in the one spelling a block is stored in, or the
// id of one that stores none
export type ReadElement =
  | { readonly kind: "block"; readonly block: LibraryBlock; readonly hash: string }
  | { readonly kind: "refused"; readonly id: string | null };

// the element's block, read once per element object: an element Slate left as it was is the
// same object, so a value of thousands of blocks is read only where it changed
export type ElementReads = WeakMap<TElement, ReadElement>;

const validId = (value: string | undefined): string | null =>
  value !== undefined && blockIdSchema.validate(value) ? value : null;

const withoutPickers = (element: TElement): TElement => ({
  ...element,
  children: element.children.flatMap((child): Descendant[] => {
    if (!ElementApi.isElement(child)) {
      return [child];
    }
    return PICKER_INPUT_TYPES.includes(child.type) ? [] : [withoutPickers(child)];
  }),
});

export const readElement = (element: TElement, reads?: ElementReads): ReadElement => {
  const known = reads?.get(element);
  if (known !== undefined) {
    return known;
  }
  const id = validId(stringProp(element, "id"));
  let read: ReadElement = { id, kind: "refused" };
  if (id !== null) {
    const parsed = storableBlockSchema.safeParse(
      namedBlockJson(
        { element: tidyBlock(withoutPickers(element)), ref: validId(stringProp(element, "ref")) },
        id,
      ),
    );
    if (parsed.success) {
      read = { block: parsed.data, hash: blockHash(parsed.data), kind: "block" };
    }
  }
  reads?.set(element, read);
  return read;
};

export interface ValueDiff {
  readonly ops: readonly LibraryOp[];
  // the ids of the elements no block can store, null for one with none, which this diff leaves as
  // they were acknowledged
  readonly heldBack: readonly (string | null)[];
}

interface Placed {
  readonly block: LibraryBlock;
  readonly hash: string;
  readonly section: LibrarySection;
}

// each block's section by where it stands: the article starts at the first block the
// acknowledged item holds in it, and a block written after that is the article's too
const sectionsOf = (
  blocks: readonly LibraryBlock[],
  acked: ReadonlyMap<string, StoredBlock>,
): LibrarySection[] => {
  const start = blocks.findIndex((block) => acked.get(block.id)?.section === "article");
  return blocks.map((_, index) => (start !== -1 && index >= start ? "article" : "note"));
};

// the keys a section's blocks take in the order the value holds them, keeping every key that
// still fits
const keysFor = (
  placed: readonly Placed[],
  section: LibrarySection,
  acked: ReadonlyMap<string, StoredBlock>,
): Map<string, string> => {
  const order = placed.filter((one) => one.section === section).map((one) => one.block.id);
  const current = new Map<string, string>();
  for (const id of order) {
    const held = acked.get(id);
    if (held?.section === section) {
      current.set(id, held.ord);
    }
  }
  return placeInOrder(order, current, new Map());
};

export const diffValue = (
  acked: ReadonlyMap<string, StoredBlock>,
  value: readonly TElement[],
  reads?: ElementReads,
): ValueDiff => {
  const heldBack: (string | null)[] = [];
  const kept = new Set<string>();
  const blocks: LibraryBlock[] = [];
  const hashes = new Map<string, string>();
  for (const element of value) {
    const read = readElement(element, reads);
    if (read.kind === "refused") {
      heldBack.push(read.id);
      if (read.id !== null) {
        kept.add(read.id);
      }
      continue;
    }
    if (hashes.has(read.block.id) || kept.has(read.block.id)) {
      heldBack.push(read.block.id);
      continue;
    }
    blocks.push(read.block);
    hashes.set(read.block.id, read.hash);
  }
  const sections = sectionsOf(blocks, acked);
  const placed = blocks.map((block, index) => ({
    block,
    hash: hashes.get(block.id) ?? "",
    section: sections[index] ?? "note",
  }));
  const keys = new Map([...keysFor(placed, "note", acked), ...keysFor(placed, "article", acked)]);
  const ops: LibraryOp[] = [];
  for (const [id, held] of acked) {
    const moved = placed.some((one) => one.block.id === id && one.section !== held.section);
    if ((!hashes.has(id) && !kept.has(id)) || moved) {
      ops.push({ baseHash: held.hash, blockId: id, op: "drop" });
    }
  }
  for (const { block, hash, section } of placed) {
    const held = acked.get(block.id);
    const ord = keys.get(block.id) ?? "";
    if (held === undefined || held.section !== section) {
      ops.push({ block, op: "insert", ord, section });
      continue;
    }
    if (hash !== held.hash) {
      ops.push({ baseHash: held.hash, block, op: "put" });
    }
    if (ord !== held.ord) {
      ops.push({ baseOrd: held.ord, blockId: block.id, op: "move", ord });
    }
  }
  return { heldBack, ops };
};
