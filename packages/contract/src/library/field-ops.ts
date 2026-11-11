// What a write does to an item's fields, apart from its body: each op names the base it was computed
// from and lands only where that base holds, a scalar set whole, a list merged as a set and a
// property by its key. A batch lands whole or answers every conflict, an op already true is
// satisfied, and a batch whose fields break a cap lands none.

import { z } from "zod";

import { sameJson } from "./canonical-json";
import type { JsonValue } from "./canonical-json";
import { libraryItemFieldsSchema, propertyKeySchema } from "./library-item";
import type { LibraryItemField, LibraryItemFields, PropertyValue } from "./library-item";

export type ScalarField = Exclude<keyof LibraryItemFields, "aliases" | "properties" | "tags">;

const isScalarField = (field: keyof LibraryItemFields): field is ScalarField =>
  field !== "aliases" && field !== "properties" && field !== "tags";

// read off the schema, so a field it gains is one an undo restores
export const SCALAR_FIELDS = libraryItemFieldsSchema.keyof().options.filter(isScalarField);

const listKey = (op: "aliases" | "tags") => (entry: string) =>
  op === "tags" ? entry.toLowerCase() : entry;

// three-way over a list kept as a set: `current`, less what `base` had and `value` dropped, plus
// what `value` added, in the order it added them. An entry `value` spells anew under a key `base`
// held takes that spelling where it stands; one `value` left as `base` spelled it stays as it is
export const mergeListField = (
  op: "aliases" | "tags",
  current: readonly string[],
  base: readonly string[],
  value: readonly string[],
): string[] => {
  const keyOf = listKey(op);
  const kept = new Map(value.map((entry) => [keyOf(entry), entry]));
  const had = new Set(base.map(keyOf));
  const removed = new Set([...had].filter((key) => !kept.has(key)));
  const written = new Set(value);
  const respelled = new Set(base.filter((entry) => !written.has(entry)).map(keyOf));
  const spelled = (entry: string): string => {
    const key = keyOf(entry);
    return respelled.has(key) ? (kept.get(key) ?? entry) : entry;
  };
  const merged = [...new Set(current.filter((entry) => !removed.has(keyOf(entry))).map(spelled))];
  const present = new Set(merged.map(keyOf));
  for (const entry of value) {
    const key = keyOf(entry);
    if (!had.has(key) && !present.has(key)) {
      merged.push(entry);
      present.add(key);
    }
  }
  return merged;
};

export const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((entry, index) => entry === b[index]);

export const sameOptionalJson = (a: JsonValue | undefined, b: JsonValue | undefined): boolean =>
  a === undefined || b === undefined ? a === b : sameJson(a, b);

const FIELDS = libraryItemFieldsSchema.shape;

const setOf = <F extends ScalarField>(field: F) =>
  z.strictObject({
    base: FIELDS[field],
    field: z.literal(field),
    op: z.literal("set"),
    value: FIELDS[field],
  });

// one variant per field, so a patch's values are its field's own type
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

// a list field merges as a set: what the writer added goes in, what it took out goes, and what
// anyone else did since stays, so two devices tagging one item at once both land
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

// one property by its key; a missing base or value is the property absent. The value's size is
// the item's to hold: the fields are checked whole once a batch lands
const propertyOpSchema = z.strictObject({
  base: z.json().optional(),
  key: propertyKeySchema,
  op: z.literal("property"),
  value: z.json().optional(),
});

export const fieldOpSchema = z.discriminatedUnion("op", [
  setOpSchema,
  tagsOpSchema,
  aliasesOpSchema,
  propertyOpSchema,
]);
export type FieldOp = z.infer<typeof fieldOpSchema>;

// what an op met instead of its base; a conflict on a list field cannot happen
export type FieldConflict =
  | { readonly kind: "field"; readonly field: ScalarField; readonly current: JsonValue }
  | { readonly kind: "property"; readonly key: string; readonly current: JsonValue | undefined };

// `satisfied`: what the op would make is already there (a resend after a lost answer, or two
// writers doing the same thing), so landing it changes nothing
type FieldVerdict =
  | { readonly kind: "apply" }
  | { readonly kind: "satisfied" }
  | { readonly kind: "conflict"; readonly conflict: FieldConflict };

const APPLY: FieldVerdict = { kind: "apply" };
const SATISFIED: FieldVerdict = { kind: "satisfied" };

const propertyAt = (fields: LibraryItemFields, key: string): JsonValue | undefined =>
  Object.hasOwn(fields.properties, key) ? fields.properties[key] : undefined;

const fieldVerdict = (fields: LibraryItemFields, op: FieldOp): FieldVerdict => {
  switch (op.op) {
    case "set": {
      const current = fields[op.field];
      if (current === op.base) {
        return APPLY;
      }
      return current === op.value
        ? SATISFIED
        : { conflict: { current, field: op.field, kind: "field" }, kind: "conflict" };
    }
    case "tags":
    case "aliases": {
      const current = fields[op.op];
      return sameList(mergeListField(op.op, current, op.base, op.value), current)
        ? SATISFIED
        : APPLY;
    }
    case "property": {
      const current = propertyAt(fields, op.key);
      if (sameOptionalJson(current, op.base)) {
        return APPLY;
      }
      return sameOptionalJson(current, op.value)
        ? SATISFIED
        : { conflict: { current, key: op.key, kind: "property" }, kind: "conflict" };
    }
    // no default
  }
};

const withField = <F extends ScalarField>(
  fields: LibraryItemFields,
  field: F,
  value: LibraryItemFields[F],
): LibraryItemFields => ({ ...fields, [field]: value });

const withProperty = (
  fields: LibraryItemFields,
  key: string,
  value: PropertyValue | undefined,
): LibraryItemFields => {
  const properties = Object.fromEntries(
    Object.entries(fields.properties).filter(([name]) => name !== key),
  );
  if (value !== undefined) {
    properties[key] = value;
  }
  return { ...fields, properties };
};

// the fields with one op landed, whose guard already passed
const landFieldOp = (fields: LibraryItemFields, op: FieldOp): LibraryItemFields => {
  switch (op.op) {
    case "set": {
      return withField(fields, op.field, op.value);
    }
    case "tags":
    case "aliases": {
      return { ...fields, [op.op]: mergeListField(op.op, fields[op.op], op.base, op.value) };
    }
    case "property": {
      return withProperty(fields, op.key, op.value);
    }
    // no default
  }
};

const fieldNameSchema = libraryItemFieldsSchema.keyof();

// the fields an item's caps refuse, by name; none when the fields hold
const refusedFields = (fields: LibraryItemFields): LibraryItemField[] => {
  const parsed = libraryItemFieldsSchema.safeParse(fields);
  if (parsed.success) {
    return [];
  }
  const names = new Set<LibraryItemField>();
  for (const issue of parsed.error.issues) {
    const name = fieldNameSchema.safeParse(issue.path[0]);
    if (name.success) {
      names.add(name.data);
    }
  }
  return [...names].toSorted();
};

// `invalid`: every op's guard held, but the fields they leave break the item's own caps (a list
// merged past its length or bytes, the properties past theirs), since each op is checked alone;
// it names those fields, and the cell answers it as too large
export type FieldOutcome =
  | { readonly kind: "applied"; readonly fields: LibraryItemFields; readonly changed: boolean }
  | { readonly kind: "conflict"; readonly conflicts: readonly FieldConflict[] }
  | { readonly kind: "invalid"; readonly fields: readonly LibraryItemField[] };

// every op in order, each against the fields as the ones before it left them; one conflict lands
// none, and the answer names every op that met one
export const applyFieldOps = (fields: LibraryItemFields, ops: readonly FieldOp[]): FieldOutcome => {
  let next = fields;
  let changed = false;
  const conflicts: FieldConflict[] = [];
  for (const op of ops) {
    const verdict = fieldVerdict(next, op);
    if (verdict.kind === "conflict") {
      conflicts.push(verdict.conflict);
    } else if (verdict.kind === "apply") {
      next = landFieldOp(next, op);
      changed = true;
    }
  }
  if (conflicts.length > 0) {
    return { conflicts, kind: "conflict" };
  }
  const refused = changed ? refusedFields(next) : [];
  return refused.length > 0
    ? { fields: refused, kind: "invalid" }
    : { changed, fields: next, kind: "applied" };
};
