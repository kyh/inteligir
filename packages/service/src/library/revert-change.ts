// Takes one change set's change to an item's fields back while keeping every change made since:
// each field run backwards three ways, the set's after as the base, the item now as mine and the
// set's before as theirs. A field the set changed and someone changed again keeps the item whole
// and names it; Undo never takes an item half back. What an agent's set did to a note's body is
// that note's to take back (`../note/turn-log`). Fields in, ops out: the caller lands them through
// the guarded apply every write takes.

import { sameJson } from "@repo/contract/library/canonical-json";
import {
  applyFieldOps,
  fieldOpSchema,
  SCALAR_FIELDS,
  sameList,
  sameOptionalJson,
} from "@repo/contract/library/field-ops";
import type { FieldOp, ScalarField } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

// a fill's own change set for an item, which is the record of what it wrote there
export interface FillChange {
  readonly before: LibraryItemFields;
  readonly after: LibraryItemFields;
}

// what a change set did to one item's fields: `before` null when the set made it, with every fill
// of the item since
export type ItemChange =
  | { readonly before: LibraryItemFields; readonly after: LibraryItemFields }
  | {
      readonly before: null;
      readonly after: LibraryItemFields;
      readonly fills: readonly FillChange[];
    };

type MadeItem = Extract<ItemChange, { before: null }>;

// the item as it is now, and whether anyone but an agent ever wrote in its note
export interface ItemNow {
  readonly fields: LibraryItemFields;
  readonly bodyEdited: boolean;
}

type ItemRevertKeepReason = "edited-since" | "purged";

/** @internal */
export type ItemRevert =
  | { readonly kind: "unchanged" }
  | {
      readonly kind: "revert";
      readonly ops: readonly FieldOp[];
      // the item's fields once the ops land
      readonly fields: LibraryItemFields;
    }
  | { readonly kind: "keep"; readonly reason: ItemRevertKeepReason };

/** @internal */
export interface ItemRevertInput {
  readonly change: ItemChange;
  readonly now: ItemNow | null;
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
): FieldOp => fieldOpSchema.parse({ base, field, op: "set", value });

// null: a field the set changed was changed again since
const fieldOps = (
  before: LibraryItemFields,
  after: LibraryItemFields,
  now: LibraryItemFields,
): FieldOp[] | null => {
  const ops: FieldOp[] = [];
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

// whether anyone but a fill changed the item since `left`: a field holds what `left` holds or what
// a fill wrote there, read off the fill's own change, since one field can be either's (a fill names
// an unread link, and a person renames it). A fill writes no folder or list, so a change to either
// is a person's, as is any writing in the item's note
const personTouched = (
  left: LibraryItemFields,
  fills: readonly FillChange[],
  now: ItemNow,
): boolean => {
  const { fields } = now;
  const fillWrote = (field: ScalarField): boolean =>
    fills.some(
      (fill) => fill.after[field] === fields[field] && fill.before[field] !== fill.after[field],
    );
  return (
    now.bodyEdited ||
    !(
      SCALAR_FIELDS.every((field) => fields[field] === left[field] || fillWrote(field)) &&
      fields.folderId === left.folderId &&
      sameList(fields.tags, left.tags) &&
      sameList(fields.aliases, left.aliases) &&
      sameJson(fields.properties, left.properties)
    )
  );
};

const landed = (now: ItemNow, ops: readonly FieldOp[]): ItemRevert => {
  const outcome = applyFieldOps(now.fields, ops);
  // an edit since that the undo meets, or one that leaves no room for what the set took out (a
  // tag list refilled to its cap): either way the item stays whole
  if (outcome.kind !== "applied") {
    return EDITED_SINCE;
  }
  return outcome.changed ? { fields: outcome.fields, kind: "revert", ops } : UNCHANGED;
};

// an item the set made goes to Deleted, unless a person has touched it since: a fill reading its
// page since is not a reason to keep it
const revertCreated = (change: MadeItem, now: ItemNow | null, at: number): ItemRevert => {
  if (now?.fields.deletedAt !== null) {
    return UNCHANGED;
  }
  if (personTouched(change.after, change.fills, now)) {
    return EDITED_SINCE;
  }
  return landed(now, [setOp("deletedAt", null, at)]);
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
  const ops = fieldOps(change.before, change.after, now.fields);
  return ops === null ? EDITED_SINCE : landed(now, ops);
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
    for (const [itemId, change] of set.items) {
      const undone = items.get(itemId);
      const now = undone === undefined ? (input.now.get(itemId) ?? null) : undone.now;
      const verdict = revertItemChange({ at: input.at, change, now });
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
