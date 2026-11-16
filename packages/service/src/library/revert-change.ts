// What a change set did to one item's fields, built at each of its landings, and taken back by its
// Undo while keeping every change made since: the entry's ops land through the guarded apply every
// write takes, so a field the set changed and someone changed again keeps the item whole and names
// it; Undo never takes an item half back. What an agent's set did to a note's body is that note's
// to take back (`../note/turn-log`).

import { canonicalJson } from "@repo/contract/library/canonical-json";
import { applyFieldOps, composeInverse } from "@repo/contract/library/field-ops";
import type { FieldOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

// an item the set made, its fields as the set last left them; or the ops that take what the set
// changed back, each guarded by what the set left
export type SetEntry =
  | { readonly kind: "made"; readonly fields: LibraryItemFields }
  | { readonly kind: "changed"; readonly inverse: readonly FieldOp[] };

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

// the item as it is now, and whether anyone but an agent ever wrote in its note
export interface ItemNow {
  readonly fields: LibraryItemFields;
  readonly bodyEdited: boolean;
}

type ItemRevertKeepReason = "edited-since" | "purged";

export type ItemRevert =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "revert";
      readonly ops: readonly FieldOp[];
      // the item's fields once the ops land
      readonly fields: LibraryItemFields;
    }
  | { readonly kind: "keep"; readonly reason: ItemRevertKeepReason };

export interface ItemRevertInput {
  readonly entry: SetEntry;
  readonly now: ItemNow | null;
  // when an item the set made is moved to Deleted
  readonly at: number;
}

const UNCHANGED: ItemRevert = { kind: "unchanged" };
const EDITED_SINCE: ItemRevert = { kind: "keep", reason: "edited-since" };

const landed = (now: ItemNow, ops: readonly FieldOp[]): ItemRevert => {
  const outcome = applyFieldOps(now.fields, ops);
  // an edit since that the undo meets, or one that leaves no room for what the set took out (a
  // tag list refilled to its cap): either way the item stays whole
  if (outcome.kind !== "applied") {
    return EDITED_SINCE;
  }
  return outcome.changed ? { fields: outcome.fields, kind: "revert", ops } : UNCHANGED;
};

// an item the set made goes to Deleted, unless a person has touched it since, in its fields or its
// note
const revertMade = (made: LibraryItemFields, now: ItemNow | null, at: number): ItemRevert => {
  if (now?.fields.deletedAt !== null) {
    return UNCHANGED;
  }
  if (now.bodyEdited || canonicalJson(now.fields) !== canonicalJson(made)) {
    return EDITED_SINCE;
  }
  return landed(now, [{ base: null, field: "deletedAt", op: "set", value: at }]);
};

export const revertItemChange = (input: ItemRevertInput): ItemRevert => {
  const { entry, now } = input;
  if (entry.kind === "made") {
    return revertMade(entry.fields, now, input.at);
  }
  return now === null ? { kind: "keep", reason: "purged" } : landed(now, entry.inverse);
};

// one change set as an undo reads it: what it did to each item it touched
interface ChangeSetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, SetEntry>;
}

export interface ChangeSetsRevertInput {
  // newest first: "Undo this conversation" passes every set its thread opened
  readonly sets: readonly ChangeSetEntries[];
  // each item as it is now, null once purged
  readonly now: ReadonlyMap<string, ItemNow | null>;
  readonly at: number;
}

interface ItemUndo {
  // every op the undo lands on the item, in order, against the item as it is now
  readonly ops: readonly FieldOp[];
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
    for (const [itemId, entry] of set.items) {
      const undone = items.get(itemId);
      const now = undone === undefined ? (input.now.get(itemId) ?? null) : undone.now;
      const verdict = revertItemChange({ at: input.at, entry, now });
      if (verdict.kind === "keep") {
        kept.push({ itemId, reason: verdict.reason, setId: set.id });
      } else if (verdict.kind === "revert" && now !== null) {
        takenBack.add(set.id);
        items.set(itemId, {
          now: { bodyEdited: now.bodyEdited, fields: verdict.fields },
          ops: [...(undone?.ops ?? []), ...verdict.ops],
        });
      }
    }
  }
  const leftWhole = new Set(kept.map(({ setId }) => setId).filter((id) => !takenBack.has(id)));
  return { items, kept, leftWhole };
};
