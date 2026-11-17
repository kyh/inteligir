// An item's way back as a change set keeps it: one op a slot (a field, a list, a property by its
// key), each guarded by the value the set left, since an Undo lands them long after, over edits
// made since. A field sets whole, a list merges as a set and a property is the device's own op
// (`@repo/contract/library/field-ops`). Each of the set's landings composes its own in
// (`composeInverse`), and only the set's Undo lands them.

import {
  applyGuarded,
  landPropertyOp,
  mergeListField,
  propertyAt,
  propertyOpSchema,
  propertyVerdict,
  sameList,
  sameOptionalJson,
} from "@repo/contract/library/field-ops";
import type { GuardedOutcome, OpVerdict } from "@repo/contract/library/field-ops";
import { libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { z } from "zod";

type ScalarField = Exclude<keyof LibraryItemFields, "aliases" | "properties" | "tags">;

const isScalarField = (field: keyof LibraryItemFields): field is ScalarField =>
  field !== "aliases" && field !== "properties" && field !== "tags";

// read off the schema, so a field it gains is one an undo restores
export const SCALAR_FIELDS = libraryItemFieldsSchema.keyof().options.filter(isScalarField);

const FIELDS = libraryItemFieldsSchema.shape;

const setOf = <F extends ScalarField>(field: F) =>
  z.strictObject({
    base: FIELDS[field],
    field: z.literal(field),
    op: z.literal("set"),
    value: FIELDS[field],
  });

// one variant per field, so an op's values are its field's own type
const setOpSchema = z.discriminatedUnion("field", [
  setOf("author"),
  setOf("coverSha"),
  setOf("deletedAt"),
  setOf("description"),
  setOf("fetchError"),
  setOf("fetchState"),
  setOf("fetchedAt"),
  setOf("folderId"),
  setOf("kind"),
  setOf("lang"),
  setOf("originalName"),
  setOf("originalSha"),
  setOf("pinnedAt"),
  setOf("published"),
  setOf("savedAt"),
  setOf("site"),
  setOf("title"),
  setOf("url"),
]);

// a list merges as a set: what the set added goes, what it took out comes back, and what anyone
// else did since stays
const tagsOpSchema = z.strictObject({
  base: FIELDS.tags,
  op: z.literal("tags"),
  value: FIELDS.tags,
});
const aliasesOpSchema = z.strictObject({
  base: FIELDS.aliases,
  op: z.literal("aliases"),
  value: FIELDS.aliases,
});

export const inverseOpSchema = z.discriminatedUnion("op", [
  setOpSchema,
  tagsOpSchema,
  aliasesOpSchema,
  propertyOpSchema,
]);
export type InverseOp = z.infer<typeof inverseOpSchema>;

const verdictOf = (fields: LibraryItemFields, op: InverseOp): OpVerdict => {
  switch (op.op) {
    case "set": {
      const current = fields[op.field];
      if (current === op.base) {
        return "apply";
      }
      return current === op.value ? "satisfied" : "conflict";
    }
    case "tags":
    case "aliases": {
      const current = fields[op.op];
      return sameList(mergeListField(op.op, current, op.base, op.value), current)
        ? "satisfied"
        : "apply";
    }
    case "property": {
      return propertyVerdict(fields, op);
    }
    // no default
  }
};

const withField = <F extends ScalarField>(
  fields: LibraryItemFields,
  field: F,
  value: LibraryItemFields[F],
): LibraryItemFields => ({ ...fields, [field]: value });

// the fields with one op landed, whose guard already passed
const landOp = (fields: LibraryItemFields, op: InverseOp): LibraryItemFields => {
  switch (op.op) {
    case "set": {
      return withField(fields, op.field, op.value);
    }
    case "tags":
    case "aliases": {
      return { ...fields, [op.op]: mergeListField(op.op, fields[op.op], op.base, op.value) };
    }
    case "property": {
      return landPropertyOp(fields, op);
    }
    // no default
  }
};

// the way back landed on the item as it is now: whole, or not at all where an edit since meets it
export const applyInverse = (
  fields: LibraryItemFields,
  ops: readonly InverseOp[],
): GuardedOutcome => applyGuarded(fields, ops, verdictOf, landOp);

// what an op writes: a field by its name, a property by its key
const slotOf = (op: InverseOp): string => {
  switch (op.op) {
    case "set": {
      return op.field;
    }
    case "property": {
      return `property:${op.key}`;
    }
    case "tags":
    case "aliases": {
      return op.op;
    }
    // no default
  }
};

// the ops that take `from` to `to`, each guarded by `from`
const opsBetween = (from: LibraryItemFields, to: LibraryItemFields): InverseOp[] => {
  const ops: InverseOp[] = [];
  for (const field of SCALAR_FIELDS) {
    if (from[field] !== to[field]) {
      // the parse ties the values to the field's own type, which TypeScript cannot follow through
      // a loop over every field
      ops.push(inverseOpSchema.parse({ base: from[field], field, op: "set", value: to[field] }));
    }
  }
  for (const op of ["tags", "aliases"] as const) {
    if (!sameList(from[op], to[op])) {
      ops.push({ base: from[op], op, value: to[op] });
    }
  }
  for (const key of new Set([...Object.keys(from.properties), ...Object.keys(to.properties)])) {
    const [base, value] = [propertyAt(from, key), propertyAt(to, key)];
    if (!sameOptionalJson(base, value)) {
      ops.push({ base, key, op: "property", value });
    }
  }
  return ops;
};

// The ops that take an item back from `after` to where `inverse` takes `before`: a set's way back,
// one more landing of its own taken in. Each slot the landing changed gets one op, guarded by
// `after`, back to `before` with the earlier op landed, or to `before` as it stands where someone
// else changed the slot since; every other slot keeps its op. So an edit made between two of the
// set's landings is never taken back, and one made since the set last wrote a slot meets that
// slot's guard.
export const composeInverse = (
  inverse: readonly InverseOp[],
  before: LibraryItemFields,
  after: LibraryItemFields,
): InverseOp[] => {
  const landed = new Set(opsBetween(before, after).map(slotOf));
  let target = before;
  for (const op of inverse) {
    if (landed.has(slotOf(op)) && verdictOf(target, op) === "apply") {
      target = landOp(target, op);
    }
  }
  return [
    ...inverse.filter((op) => !landed.has(slotOf(op))),
    ...opsBetween(after, target).filter((op) => landed.has(slotOf(op))),
  ];
};
