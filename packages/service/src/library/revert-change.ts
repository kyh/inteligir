import { canonicalJson } from "@repo/contract/library/canonical-json";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";

import { applyInverse, composeInverse } from "./inverse-ops";
import type { InverseOp } from "./inverse-ops";

export type SetEntry =
  | { readonly kind: "made"; readonly fields: LibraryItemFields }
  | { readonly kind: "changed"; readonly inverse: readonly InverseOp[] };

export interface BodyEntry {
  readonly blocksBefore: readonly BodyBlock[];
  readonly versionBefore: number;
  readonly versionAfter: number;
}

export interface ItemEntry {
  readonly fields: SetEntry;
  readonly body: BodyEntry | null;
}

export const nextEntry = (
  entry: SetEntry | null,
  before: LibraryItemFields | null,
  after: LibraryItemFields,
) =>
  (before === null || entry?.kind === "made"
    ? { fields: after, kind: "made" }
    : {
        inverse: composeInverse(entry?.inverse ?? [], before, after),
        kind: "changed",
      }) satisfies SetEntry;

export interface ItemNow {
  readonly fields: LibraryItemFields;
  readonly bodyVersion: number;
}

export interface ItemBack extends ItemNow {
  readonly blocks: readonly BodyBlock[] | null;
}

export type ItemRevert =
  | { readonly kind: "unchanged" }
  | { readonly kind: "revert"; readonly back: ItemBack }
  | { readonly kind: "keep" };

export interface ItemRevertInput {
  readonly entry: ItemEntry;
  readonly now: ItemBack;
  readonly at: number;
}

const UNCHANGED: ItemRevert = { kind: "unchanged" };
const EDITED_SINCE: ItemRevert = { kind: "keep" };

const changedBack = (now: ItemBack, ops: readonly InverseOp[], body: BodyEntry | null) => {
  const outcome = applyInverse(now.fields, ops);

  if (outcome.kind === "conflict" || !libraryItemFieldsSchema.validate(outcome.fields)) {
    return EDITED_SINCE;
  }

  if (body === null) {
    return (
      outcome.changed ? { back: { ...now, fields: outcome.fields }, kind: "revert" } : UNCHANGED
    ) satisfies ItemRevert;
  }

  return {
    back: { blocks: body.blocksBefore, bodyVersion: body.versionBefore, fields: outcome.fields },
    kind: "revert",
  } satisfies ItemRevert;
};

const madeBack = (made: LibraryItemFields, now: ItemBack, at: number) => {
  if (now.fields.deletedAt !== null) {
    return UNCHANGED;
  }

  if (canonicalJson(now.fields) !== canonicalJson(made)) {
    return EDITED_SINCE;
  }

  return {
    back: { ...now, fields: { ...now.fields, deletedAt: at } },
    kind: "revert",
  } satisfies ItemRevert;
};

export const revertItemChange = (input: ItemRevertInput) => {
  const { entry, now } = input;

  if (entry.body !== null && now.bodyVersion !== entry.body.versionAfter) {
    return EDITED_SINCE;
  }

  return entry.fields.kind === "made"
    ? madeBack(entry.fields.fields, now, input.at)
    : changedBack(now, entry.fields.inverse, entry.body);
};

export interface HeldEntry {
  readonly entry: ItemEntry;
  readonly now: ItemNow;
}

interface ChangeSetEntries {
  readonly id: string;
  readonly items: ReadonlyMap<string, HeldEntry>;
}

export interface ChangeSetsRevertInput {
  readonly sets: readonly ChangeSetEntries[];
  readonly at: number;
}

interface KeptChange {
  readonly setId: string;
  readonly itemId: string;
}

interface ChangeSetsRevert {
  readonly items: ReadonlyMap<string, ItemBack>;
  readonly kept: readonly KeptChange[];
}

export const revertChangeSets = (input: ChangeSetsRevertInput) => {
  const items = new Map<string, ItemBack>();
  const kept: KeptChange[] = [];

  for (const set of input.sets) {
    for (const [itemId, held] of set.items) {
      const now = items.get(itemId) ?? { ...held.now, blocks: null };
      const verdict = revertItemChange({ at: input.at, entry: held.entry, now });

      if (verdict.kind === "keep") {
        kept.push({ itemId, setId: set.id });
      } else if (verdict.kind === "revert") {
        items.set(itemId, verdict.back);
      }
    }
  }

  return { items, kept } satisfies ChangeSetsRevert;
};
