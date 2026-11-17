// What a change set did to one item, built at each of its landings, and taken back by its Undo
// while keeping every change made since: the entry's way back is guarded by what the set left
// (`./inverse-ops`), its body by the version the set's last write left it at, so a field or a body
// someone changed again keeps the item whole and names it; Undo never takes an item half back.

import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

import { applyInverse, composeInverse } from "./inverse-ops";
import type { InverseOp } from "./inverse-ops";

// an item the set made, its fields as the set last left them; or the ops that take what the set
// changed back, each guarded by what the set left
export type SetEntry =
  | { readonly kind: "made"; readonly fields: LibraryItemFields }
  | { readonly kind: "changed"; readonly inverse: readonly InverseOp[] };

// the body a set wrote: its blocks before the set's first write and the version they stood at, and
// the version the set's last write left
export interface BodyEntry {
  readonly blocksBefore: readonly BodyBlock[];
  readonly versionBefore: number;
  readonly versionAfter: number;
}

// all a set did to one item: its fields, and its body when the set wrote one
export interface ItemEntry {
  readonly fields: SetEntry;
  readonly body: BodyEntry | null;
}

// the entry once one more of the set's landings is in it: `before` null when that landing made the
// item
export const nextEntry = (
  entry: SetEntry | null,
  before: LibraryItemFields | null,
  after: LibraryItemFields,
): SetEntry =>
  before === null || entry?.kind === "made"
    ? { fields: after, kind: "made" }
    : { inverse: composeInverse(entry?.inverse ?? [], before, after), kind: "changed" };

// the item as it is now: its fields, and the version its body stands at
export interface ItemNow {
  readonly fields: LibraryItemFields;
  readonly bodyVersion: number;
}

// the item once the set's way back lands: its fields, its body's version, and the blocks the body
// goes back to, null while it stays as it is
export interface ItemBack extends ItemNow {
  readonly blocks: readonly BodyBlock[] | null;
}

type ItemRevertKeepReason = "edited-since" | "purged";

export type ItemRevert =
  | { readonly kind: "unchanged" }
  | { readonly kind: "revert"; readonly back: ItemBack }
  | { readonly kind: "keep"; readonly reason: ItemRevertKeepReason };

export interface ItemRevertInput {
  readonly entry: ItemEntry;
  // the item as it is now, the blocks a newer set's way back left it with; null once purged
  readonly now: ItemBack | null;
  // when an item the set made is moved to Deleted
  readonly at: number;
}

const UNCHANGED: ItemRevert = { kind: "unchanged" };
const EDITED_SINCE: ItemRevert = { kind: "keep", reason: "edited-since" };

// the set's way back for an item it changed: its fields' ops, and its body's blocks before it
const changedBack = (
  now: ItemBack,
  ops: readonly InverseOp[],
  body: BodyEntry | null,
): ItemRevert => {
  const outcome = applyInverse(now.fields, ops);
  // an edit since that the undo meets, or one that leaves no room for what the set took out (a
  // tag list refilled to its cap): either way the item stays whole
  if (outcome.kind === "conflict" || !libraryItemFieldsSchema.validate(outcome.fields)) {
    return EDITED_SINCE;
  }
  if (body === null) {
    return outcome.changed
      ? { back: { ...now, fields: outcome.fields }, kind: "revert" }
      : UNCHANGED;
  }
  return {
    back: { blocks: body.blocksBefore, bodyVersion: body.versionBefore, fields: outcome.fields },
    kind: "revert",
  };
};

// an item the set made goes to Deleted, unless a person has touched it since, in its fields or its
// body
const madeBack = (made: LibraryItemFields, now: ItemBack | null, at: number): ItemRevert => {
  if (now?.fields.deletedAt !== null) {
    return UNCHANGED;
  }
  if (canonicalJson(now.fields) !== canonicalJson(made)) {
    return EDITED_SINCE;
  }
  return { back: { ...now, fields: { ...now.fields, deletedAt: at } }, kind: "revert" };
};

export const revertItemChange = (input: ItemRevertInput): ItemRevert => {
  const { entry, now } = input;
  if (now !== null && entry.body !== null && now.bodyVersion !== entry.body.versionAfter) {
    return EDITED_SINCE;
  }
  if (entry.fields.kind === "made") {
    return madeBack(entry.fields.fields, now, input.at);
  }
  return now === null
    ? { kind: "keep", reason: "purged" }
    : changedBack(now, entry.fields.inverse, entry.body);
};

// one change set as an undo reads it: what it did to each item it touched
interface ChangeSetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, ItemEntry>;
}

export interface ChangeSetsRevertInput {
  // newest first: "Undo this conversation" passes every set its thread opened
  readonly sets: readonly ChangeSetEntries[];
  // each item as it is now, null once purged
  readonly now: ReadonlyMap<string, ItemNow | null>;
  readonly at: number;
}

interface KeptChange {
  readonly setId: string;
  readonly itemId: string;
  readonly reason: ItemRevertKeepReason;
}

export interface ChangeSetsRevert {
  // each item the undo moves, as it leaves it
  readonly items: ReadonlyMap<string, ItemBack>;
  // an item a set changed that someone changed since: left as it is, and named, its entry the
  // set's to undo again
  readonly kept: readonly KeptChange[];
}

// several sets undone as one, newest first, each against the item as the newer ones left it, so a
// body goes back to the oldest set's blocks only while each set's last write is where the next
// newer one's first began
export const revertChangeSets = (input: ChangeSetsRevertInput): ChangeSetsRevert => {
  const items = new Map<string, ItemBack>();
  const kept: KeptChange[] = [];
  for (const set of input.sets) {
    for (const [itemId, entry] of set.items) {
      const held = input.now.get(itemId) ?? null;
      const now = items.get(itemId) ?? (held === null ? null : { ...held, blocks: null });
      const verdict = revertItemChange({ at: input.at, entry, now });
      if (verdict.kind === "keep") {
        kept.push({ itemId, reason: verdict.reason, setId: set.id });
      } else if (verdict.kind === "revert") {
        items.set(itemId, verdict.back);
      }
    }
  }
  return { items, kept };
};
