// What a write does to an item's fields, apart from its blocks: which fields are scalars a patch
// sets whole, how a list field merges as a set, and when two values are the same.

import { sameJson } from "./canonical-json";
import type { JsonValue } from "./canonical-json";
import { libraryItemFieldsSchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";

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
