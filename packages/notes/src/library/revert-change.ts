// Takes one change set's change to an item back while keeping every change made since: the change
// run backwards three ways, the set's after as the base, the item now as mine and the set's before
// as theirs, block by block and field by field. A block the set changed and someone changed again
// keeps the item whole and names it; Undo never takes an item half back.
// Snapshots in, ops out: the caller lands them through the same guarded apply every write takes.

import { diff3 } from "../text/diff3";
import {
  applyOps,
  libraryOpSchema,
  orderedBlocks,
  SCALAR_FIELDS,
  sameList,
  sameOptionalJson,
} from "./block-ops";
import type { ItemState, LibraryOp, ScalarField, StoredBlock } from "./block-ops";
import { compareBlockPlaces, placeInOrder } from "./block-order";
import { sameJson } from "./canonical-json";
import type { LibraryItemFields } from "./library-item";
import { LIBRARY_SECTIONS } from "./library-nodes";
import type { LibraryBlock, LibrarySection } from "./library-nodes";

// one block of an item at the close of a change set: what the set keeps for it, its content held
// apart under its hash
export interface ManifestEntry {
  readonly blockId: string;
  readonly hash: string;
  readonly ord: string;
  readonly section: LibrarySection;
}

export interface ItemSnapshot {
  readonly fields: LibraryItemFields;
  readonly manifest: readonly ManifestEntry[];
}

// a fill's own change set for an item, which is the record of what it wrote there
export interface FillChange {
  readonly before: LibraryItemFields;
  readonly after: LibraryItemFields;
}

// what a change set did to one item: `before` null when the set made it, with every fill of the
// item since
export type ItemChange =
  | { readonly before: ItemSnapshot; readonly after: ItemSnapshot }
  | {
      readonly before: null;
      readonly after: ItemSnapshot;
      readonly fills: readonly FillChange[];
    };

type MadeItem = Extract<ItemChange, { before: null }>;

// the item as it is now; null once it was purged
export interface ItemNow {
  readonly state: ItemState;
}

/** @internal */
export const snapshotOf = (now: ItemNow): ItemSnapshot => ({
  fields: now.state.fields,
  manifest: orderedBlocks(now.state.blocks).map((stored) => ({
    blockId: stored.block.id,
    hash: stored.hash,
    ord: stored.ord,
    section: stored.section,
  })),
});

type ItemRevertKeepReason = "edited-since" | "purged";

/** @internal */
export type ItemRevert =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "revert";
      readonly ops: readonly LibraryOp[];
      // the item once the ops land
      readonly state: ItemState;
    }
  | { readonly kind: "keep"; readonly reason: ItemRevertKeepReason };

/** @internal */
export interface ItemRevertInput {
  readonly change: ItemChange;
  readonly now: ItemNow | null;
  // a block's content by its hash, from the versions a change set keeps
  readonly blockAt: (hash: string) => LibraryBlock | undefined;
  // when an item the set made is moved to Deleted
  readonly at: number;
}

const UNCHANGED: ItemRevert = { kind: "unchanged" };
const EDITED_SINCE: ItemRevert = { kind: "keep", reason: "edited-since" };

// a field's op from two readings of that one field; the parse ties the values to the field's own
// type, which TypeScript cannot follow through a loop over every field
const setOp = (
  field: ScalarField,
  base: LibraryItemFields[ScalarField],
  value: LibraryItemFields[ScalarField],
): LibraryOp => libraryOpSchema.parse({ base, field, op: "set", value });

// null: a field the set changed was changed again since
const fieldOps = (
  before: LibraryItemFields,
  after: LibraryItemFields,
  now: LibraryItemFields,
): LibraryOp[] | null => {
  const ops: LibraryOp[] = [];
  for (const field of SCALAR_FIELDS) {
    const was = before[field];
    const made = after[field];
    const is = now[field];
    if (was === made || is === was) {
      continue;
    }
    if (is !== made) {
      return null;
    }
    ops.push(setOp(field, is, was));
  }
  for (const field of ["tags", "aliases"] as const) {
    if (!sameList(before[field], after[field])) {
      ops.push({ base: after[field], op: field, value: before[field] });
    }
  }
  const keys = new Set([...Object.keys(before.properties), ...Object.keys(after.properties)]);
  for (const key of keys) {
    const was = Object.hasOwn(before.properties, key) ? before.properties[key] : undefined;
    const made = Object.hasOwn(after.properties, key) ? after.properties[key] : undefined;
    const is = Object.hasOwn(now.properties, key) ? now.properties[key] : undefined;
    if (sameOptionalJson(was, made) || sameOptionalJson(is, was)) {
      continue;
    }
    if (!sameOptionalJson(is, made)) {
      return null;
    }
    ops.push({ base: is, key, op: "property", value: was });
  }
  return ops;
};

const versionOf = (input: ItemRevertInput, hash: string): LibraryBlock => {
  const block = input.blockAt(hash);
  if (block === undefined) {
    throw new Error(`the block version ${hash} a change set names is not kept`);
  }
  return block;
};

const idsInOrder = (entries: readonly ManifestEntry[], section: LibrarySection): string[] =>
  entries
    .filter((entry) => entry.section === section)
    .toSorted(compareBlockPlaces)
    .map((entry) => entry.blockId);

// the block ids, one per line, so diff3 merges an order the way it merges a file's lines
const linesOf = (ids: readonly string[]): string => ids.join("\n");
const idsOf = (lines: string): string[] => lines.split("\n").filter((id) => id !== "");

interface BlockPlan {
  readonly ops: LibraryOp[];
  // blocks to come back, by id, with where they belong
  readonly returning: Map<
    string,
    { readonly block: LibraryBlock; readonly section: LibrarySection }
  >;
  // blocks the set made, by id, with the hash they still hold: each goes unless the order merge
  // keeps it, which it does once someone moved it since
  readonly dropping: Map<string, string>;
}

// what each block the set touched needs, before any order is decided; null when one was changed
// again since
const contentPlan = (
  input: ItemRevertInput,
  before: ItemSnapshot,
  now: ItemState,
): BlockPlan | null => {
  const plan: BlockPlan = { dropping: new Map(), ops: [], returning: new Map() };
  const was = new Map(before.manifest.map((entry) => [entry.blockId, entry]));
  const made = new Map(input.change.after.manifest.map((entry) => [entry.blockId, entry]));
  for (const id of new Set([...was.keys(), ...made.keys()])) {
    const prior = was.get(id);
    const left = made.get(id);
    const held = now.blocks.get(id);
    if (prior !== undefined && left !== undefined) {
      if (prior.hash === left.hash || held?.hash === prior.hash) {
        continue;
      }
      if (held?.hash !== left.hash) {
        return null;
      }
      plan.ops.push({ baseHash: held.hash, block: versionOf(input, prior.hash), op: "put" });
    } else if (left !== undefined) {
      // the set made this block: it goes, unless someone changed it since
      if (held === undefined) {
        continue;
      }
      if (held.hash !== left.hash) {
        return null;
      }
      plan.dropping.set(id, held.hash);
    } else if (prior !== undefined) {
      // the set took this block out: it comes back, unless one came back under its id since
      if (held !== undefined) {
        if (held.hash !== prior.hash) {
          return null;
        }
        continue;
      }
      plan.returning.set(id, { block: versionOf(input, prior.hash), section: prior.section });
    }
  }
  return plan;
};

const placesNow = (now: ItemState, section: LibrarySection): StoredBlock[] =>
  orderedBlocks(now.blocks).filter((stored) => stored.section === section);

// each section's order merged three ways over its block ids, then keyed so as few blocks as
// possible move; a block coming back takes its old key wherever that still fits. null when the
// orders overlap, or the merge disagrees with what the blocks need
const orderOps = (
  before: ItemSnapshot,
  after: ItemSnapshot,
  now: ItemState,
  plan: BlockPlan,
): LibraryOp[] | null => {
  const ops: LibraryOp[] = [];
  for (const section of LIBRARY_SECTIONS) {
    const current = placesNow(now, section);
    const { conflicted, merged } = diff3(
      linesOf(idsInOrder(after.manifest, section)),
      linesOf(current.map((stored) => stored.block.id)),
      linesOf(idsInOrder(before.manifest, section)),
    );
    if (conflicted) {
      return null;
    }
    const order = idsOf(merged);
    const kept = new Set(order);
    const currentKeys = new Map(current.map((stored) => [stored.block.id, stored.ord]));
    for (const id of currentKeys.keys()) {
      const baseHash = plan.dropping.get(id);
      if (kept.has(id)) {
        continue;
      }
      if (baseHash === undefined) {
        return null;
      }
      ops.push({ baseHash, blockId: id, op: "drop" });
    }
    for (const id of order) {
      if (!currentKeys.has(id) && plan.returning.get(id)?.section !== section) {
        return null;
      }
    }
    const restore = new Map(
      before.manifest
        .filter((entry) => entry.section === section)
        .map((entry) => [entry.blockId, entry.ord]),
    );
    const keys = placeInOrder(order, currentKeys, restore);
    for (const id of order) {
      const key = keys.get(id);
      const held = currentKeys.get(id);
      const returning = plan.returning.get(id);
      if (key === undefined) {
        continue;
      }
      if (returning !== undefined) {
        ops.push({ block: returning.block, op: "insert", ord: key, section });
      } else if (held !== undefined && held !== key) {
        ops.push({ baseOrd: held, blockId: id, op: "move", ord: key });
      }
    }
  }
  return ops;
};

const sameNoteBlocks = (
  after: readonly ManifestEntry[],
  now: readonly ManifestEntry[],
): boolean => {
  const left = after.filter((entry) => entry.section === "note");
  const held = now.filter((entry) => entry.section === "note");
  return (
    left.length === held.length &&
    left.every(
      (entry, index) => entry.blockId === held[index]?.blockId && entry.hash === held[index].hash,
    )
  );
};

// whether anyone but a fill changed the item since `left`: a field holds what `left` holds or what
// a fill wrote there, read off the fill's own change, since one field can be either's (a fill names
// an unread link, and a person renames it). A fill writes no folder, list or note, so a change to
// any of them is a person's
const personTouched = (left: ItemSnapshot, fills: readonly FillChange[], now: ItemNow): boolean => {
  const { fields } = now.state;
  const fillWrote = (field: ScalarField): boolean =>
    fills.some(
      (fill) => fill.after[field] === fields[field] && fill.before[field] !== fill.after[field],
    );
  return !(
    SCALAR_FIELDS.every((field) => fields[field] === left.fields[field] || fillWrote(field)) &&
    fields.folderId === left.fields.folderId &&
    sameList(fields.tags, left.fields.tags) &&
    sameList(fields.aliases, left.fields.aliases) &&
    sameJson(fields.properties, left.fields.properties) &&
    sameNoteBlocks(left.manifest, snapshotOf(now).manifest)
  );
};

// an item the set made goes to Deleted, unless a person has touched it since: a fill reading its
// page since is not a reason to keep it
const revertCreated = (change: MadeItem, now: ItemNow | null, at: number): ItemRevert => {
  if (now?.state.fields.deletedAt !== null) {
    return UNCHANGED;
  }
  if (personTouched(change.after, change.fills, now)) {
    return EDITED_SINCE;
  }
  const ops = [setOp("deletedAt", null, at)];
  const landed = applyOps(now.state, ops);
  return landed.kind === "applied" ? { kind: "revert", ops, state: landed.state } : EDITED_SINCE;
};

const revertExisting = (input: ItemRevertInput, before: ItemSnapshot, now: ItemNow): ItemRevert => {
  const { after } = input.change;
  const fields = fieldOps(before.fields, after.fields, now.state.fields);
  const plan = contentPlan(input, before, now.state);
  const order = plan === null ? null : orderOps(before, after, now.state, plan);
  if (fields === null || plan === null || order === null) {
    return EDITED_SINCE;
  }
  const ops = [...fields, ...plan.ops, ...order];
  const landed = applyOps(now.state, ops);
  // an edit since that the undo meets, or one that leaves no room for what the set took out (a
  // tag list refilled to its cap): either way the item stays whole
  if (landed.kind !== "applied") {
    return EDITED_SINCE;
  }
  const changed =
    landed.touched.blocks.size > 0 || landed.touched.dropped.size > 0 || landed.touched.fields;
  return changed ? { kind: "revert", ops, state: landed.state } : UNCHANGED;
};

/** @internal */
export const revertItemChange = (input: ItemRevertInput): ItemRevert => {
  const { change, now } = input;
  if (change.before === null) {
    return revertCreated(change, now, input.at);
  }
  if (now === null) {
    return { kind: "keep", reason: "purged" };
  }
  return revertExisting(input, change.before, now);
};

// one change set as an undo reads it: what it did to each item it touched
interface ChangeSetChanges {
  readonly id: string;
  readonly items: ReadonlyMap<string, ItemChange>;
}

export interface ChangeSetsRevertInput {
  // newest first: "Undo this conversation" passes every set its thread opened
  readonly sets: readonly ChangeSetChanges[];
  // each item as it is now, null once purged
  readonly now: ReadonlyMap<string, ItemNow | null>;
  readonly blockAt: (hash: string) => LibraryBlock | undefined;
  readonly at: number;
}

interface ItemUndo {
  // every op the undo lands on the item, in order, against the item as it is now
  readonly ops: readonly LibraryOp[];
  // the item once they land
  readonly now: ItemNow;
}

interface KeptChange {
  readonly setId: string;
  readonly itemId: string;
  readonly reason: ItemRevertKeepReason;
}

export interface ChangeSetsRevert {
  readonly items: ReadonlyMap<string, ItemUndo>;
  // an item a set changed that someone changed since: left as it is, and named
  readonly kept: readonly KeptChange[];
  // the sets of which something was kept and nothing goes back
  readonly leftWhole: ReadonlySet<string>;
}

// several sets undone as one, newest first, each against the item as the newer ones left it
export const revertChangeSets = (input: ChangeSetsRevertInput): ChangeSetsRevert => {
  const items = new Map<string, ItemUndo>();
  const kept: KeptChange[] = [];
  const takenBack = new Set<string>();
  for (const set of input.sets) {
    for (const [itemId, change] of set.items) {
      const undone = items.get(itemId);
      const now = undone === undefined ? (input.now.get(itemId) ?? null) : undone.now;
      const verdict = revertItemChange({ at: input.at, blockAt: input.blockAt, change, now });
      if (verdict.kind === "keep") {
        kept.push({ itemId, reason: verdict.reason, setId: set.id });
      } else if (verdict.kind === "revert") {
        takenBack.add(set.id);
        items.set(itemId, {
          now: { state: verdict.state },
          ops: [...(undone?.ops ?? []), ...verdict.ops],
        });
      }
    }
  }
  const leftWhole = new Set(kept.map(({ setId }) => setId).filter((id) => !takenBack.has(id)));
  return { items, kept, leftWhole };
};
