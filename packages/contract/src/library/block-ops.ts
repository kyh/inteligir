// What a write is: ops over one item's blocks and fields, each naming the base it was computed
// from. The guard lands an op only where its base still holds, so two writers touching different
// blocks or fields never meet, and one whose base moved meets the block or value as it is now.
// The cell applies a batch whole or answers every conflict, and an op already true is satisfied.

import { z } from "zod";

import { BLOCK_HASH_RE, blockHash } from "./block-hash";
import { compareBlockPlaces } from "./block-order";
import { fieldOpSchema, fieldVerdict, landFieldOp, refusedFields } from "./field-ops";
import type { FieldConflict, FieldOp } from "./field-ops";
import type { LibraryItemField, LibraryItemFields } from "./library-item";
import { blockIdSchema, librarySectionSchema, storableBlockSchema } from "./library-nodes";
import type { LibraryBlock, LibrarySection } from "./library-nodes";
import { ordSchema } from "./order-key";

export interface StoredBlock {
  readonly block: LibraryBlock;
  readonly hash: string;
  readonly ord: string;
  readonly section: LibrarySection;
}

export interface ItemState {
  readonly fields: LibraryItemFields;
  readonly blocks: ReadonlyMap<string, StoredBlock>;
}

// an item's blocks in reading order: note before article, then by order key
export const orderedBlocks = (blocks: ReadonlyMap<string, StoredBlock>): StoredBlock[] =>
  [...blocks.values()].toSorted((a, b) =>
    compareBlockPlaces(
      { blockId: a.block.id, ord: a.ord, section: a.section },
      { blockId: b.block.id, ord: b.ord, section: b.section },
    ),
  );

export const blockHashSchema = z.string().regex(BLOCK_HASH_RE);

const insertOpSchema = z.strictObject({
  block: storableBlockSchema,
  op: z.literal("insert"),
  ord: ordSchema,
  section: librarySectionSchema,
});

const putOpSchema = z.strictObject({
  baseHash: blockHashSchema,
  block: storableBlockSchema,
  op: z.literal("put"),
});

const dropOpSchema = z.strictObject({
  baseHash: blockHashSchema,
  blockId: blockIdSchema,
  op: z.literal("drop"),
});

const moveOpSchema = z.strictObject({
  baseOrd: ordSchema,
  blockId: blockIdSchema,
  op: z.literal("move"),
  ord: ordSchema,
});

export const libraryOpSchema = z.union([
  z.discriminatedUnion("op", [insertOpSchema, putOpSchema, dropOpSchema, moveOpSchema]),
  fieldOpSchema,
]);
export type LibraryOp = z.infer<typeof libraryOpSchema>;

// what an op met instead of its base; a conflict on a list field cannot happen
type OpConflict =
  | { readonly kind: "block"; readonly blockId: string; readonly current: StoredBlock | null }
  | { readonly kind: "order"; readonly blockId: string; readonly currentOrd: string }
  | FieldConflict;

// `satisfied`: what the op would make is already there (a resend after a lost answer, or two
// writers doing the same thing), so landing it changes nothing
type Verdict = { readonly kind: "apply" } | { readonly kind: "satisfied" } | OpVerdictConflict;

interface OpVerdictConflict {
  readonly kind: "conflict";
  readonly conflict: OpConflict;
}

const APPLY: Verdict = { kind: "apply" };
const SATISFIED: Verdict = { kind: "satisfied" };

const conflictOf = (conflict: OpConflict): Verdict => ({ conflict, kind: "conflict" });

type BlockOp = Exclude<LibraryOp, FieldOp>;

const blockVerdict = (state: ItemState, op: BlockOp): Verdict => {
  switch (op.op) {
    case "insert": {
      const held = state.blocks.get(op.block.id);
      if (held === undefined) {
        return APPLY;
      }
      return held.hash === blockHash(op.block)
        ? SATISFIED
        : conflictOf({ blockId: op.block.id, current: held, kind: "block" });
    }
    case "put": {
      const held = state.blocks.get(op.block.id);
      if (held?.hash === op.baseHash) {
        return APPLY;
      }
      return held?.hash === blockHash(op.block)
        ? SATISFIED
        : conflictOf({ blockId: op.block.id, current: held ?? null, kind: "block" });
    }
    case "drop": {
      const held = state.blocks.get(op.blockId);
      if (held === undefined) {
        return SATISFIED;
      }
      return held.hash === op.baseHash
        ? APPLY
        : conflictOf({ blockId: op.blockId, current: held, kind: "block" });
    }
    case "move": {
      const held = state.blocks.get(op.blockId);
      // a block someone dropped needs no place
      if (held === undefined || held.ord === op.ord) {
        return SATISFIED;
      }
      return held.ord === op.baseOrd
        ? APPLY
        : conflictOf({ blockId: op.blockId, currentOrd: held.ord, kind: "order" });
    }
    // no default
  }
};

const isBlockOp = (op: LibraryOp): op is BlockOp =>
  op.op === "insert" || op.op === "put" || op.op === "drop" || op.op === "move";

const verdictOf = (state: ItemState, op: LibraryOp): Verdict =>
  isBlockOp(op) ? blockVerdict(state, op) : fieldVerdict(state.fields, op);

const withBlocks = (
  state: ItemState,
  change: (blocks: Map<string, StoredBlock>) => void,
): ItemState => {
  const blocks = new Map(state.blocks);
  change(blocks);
  return { blocks, fields: state.fields };
};

// the item with one op landed, whose guard already passed
const landOp = (state: ItemState, op: LibraryOp): ItemState => {
  switch (op.op) {
    case "insert": {
      return withBlocks(state, (blocks) => {
        blocks.set(op.block.id, {
          block: op.block,
          hash: blockHash(op.block),
          ord: op.ord,
          section: op.section,
        });
      });
    }
    case "put": {
      return withBlocks(state, (blocks) => {
        const held = blocks.get(op.block.id);
        if (held !== undefined) {
          blocks.set(op.block.id, { ...held, block: op.block, hash: blockHash(op.block) });
        }
      });
    }
    case "drop": {
      return withBlocks(state, (blocks) => {
        blocks.delete(op.blockId);
      });
    }
    case "move": {
      return withBlocks(state, (blocks) => {
        const held = blocks.get(op.blockId);
        if (held !== undefined) {
          blocks.set(op.blockId, { ...held, ord: op.ord });
        }
      });
    }
    case "set":
    case "tags":
    case "aliases":
    case "property": {
      return { blocks: state.blocks, fields: landFieldOp(state.fields, op) };
    }
    // no default
  }
};

// the blocks and fields a batch changed, so a writer stores those rows and no others
interface OpTouches {
  readonly blocks: ReadonlySet<string>;
  readonly dropped: ReadonlySet<string>;
  readonly fields: boolean;
}

// `invalid`: every op's guard held, but the fields they leave break the item's own caps (a list
// merged past its length or bytes, the properties past theirs), since each op is checked alone;
// it names those fields, and the cell answers it as too large
export type ApplyOutcome =
  | { readonly kind: "applied"; readonly state: ItemState; readonly touched: OpTouches }
  | { readonly kind: "conflict"; readonly conflicts: readonly OpConflict[] }
  | { readonly kind: "invalid"; readonly fields: readonly LibraryItemField[] };

const touchedBy = (op: LibraryOp): { block: string } | { dropped: string } | "fields" => {
  switch (op.op) {
    case "insert":
    case "put": {
      return { block: op.block.id };
    }
    case "move": {
      return { block: op.blockId };
    }
    case "drop": {
      return { dropped: op.blockId };
    }
    case "set":
    case "tags":
    case "aliases":
    case "property": {
      return "fields";
    }
    // no default
  }
};

// every op in order, each against the item as the ones before it left it; one conflict lands
// none, and the answer names every op that met one, and a batch whose fields break a cap lands
// none either
export const applyOps = (state: ItemState, ops: readonly LibraryOp[]): ApplyOutcome => {
  let next = state;
  const conflicts: OpConflict[] = [];
  const blocks = new Set<string>();
  const dropped = new Set<string>();
  let fields = false;
  for (const op of ops) {
    const verdict = verdictOf(next, op);
    if (verdict.kind === "conflict") {
      conflicts.push(verdict.conflict);
      continue;
    }
    if (verdict.kind === "satisfied") {
      continue;
    }
    next = landOp(next, op);
    const touch = touchedBy(op);
    if (touch === "fields") {
      fields = true;
    } else if ("block" in touch) {
      blocks.add(touch.block);
      dropped.delete(touch.block);
    } else {
      dropped.add(touch.dropped);
      blocks.delete(touch.dropped);
    }
  }
  if (conflicts.length > 0) {
    return { conflicts, kind: "conflict" };
  }
  const refused = fields ? refusedFields(next.fields) : [];
  if (refused.length > 0) {
    return { fields: refused, kind: "invalid" };
  }
  return { kind: "applied", state: next, touched: { blocks, dropped, fields } };
};
