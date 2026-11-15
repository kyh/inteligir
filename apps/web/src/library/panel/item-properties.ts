// An item's own properties as Info's rows: the fields the library holds in place of a
// frontmatter, each row typed by its value and each edit one property op over the value the row
// showed. A value the panel cannot edit (an object, a list that is not all words) is drawn as it
// is and never written.

import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import type { TypedProperty } from "@repo/editor/markdown/frontmatter";
import { z } from "zod";

export type Properties = LibraryItemFields["properties"];

export type PropertyEdit =
  | { readonly kind: "set"; readonly prop: TypedProperty }
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "add"; readonly prop: TypedProperty };

// the frontmatter reader's own spelling of a date, so a property reads as a date wherever it is
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;

const words = z.array(z.string());

const rowOf = (key: string, value: PropertyValue): TypedProperty => {
  const listed = words.safeParse(value);
  if (listed.success) {
    return { key, type: "tags", value: listed.data };
  }
  const checked = z.boolean().safeParse(value);
  if (checked.success) {
    return { key, type: "checkbox", value: checked.data };
  }
  const counted = z.number().safeParse(value);
  if (counted.success) {
    return { key, type: "number", value: counted.data };
  }
  const written = z.string().safeParse(value);
  if (written.success) {
    return DATE_RE.test(written.data)
      ? { key, type: "date", value: written.data }
      : { key, type: "text", value: written.data };
  }
  return { key, raw: JSON.stringify(value), type: "unsupported" };
};

// the value a row writes; null for one the panel does not edit
const valueOf = (prop: TypedProperty): PropertyValue | null =>
  prop.type === "unsupported" ? null : prop.value;

export const rowsOf = (properties: Properties): readonly TypedProperty[] =>
  Object.entries(properties).map(([key, value]) => rowOf(key, value));

// the op an edit makes over the properties the panel drew; none for an add over a key they hold,
// or a row the panel does not edit
export const patchOf = (properties: Properties, edit: PropertyEdit): PropertyOp | null => {
  const key = edit.kind === "remove" ? edit.key : edit.prop.key;
  const base = Object.hasOwn(properties, key) ? properties[key] : undefined;
  if (edit.kind === "remove") {
    return base === undefined ? null : { base, key, op: "property" };
  }
  const value = valueOf(edit.prop);
  if (value === null || (edit.kind === "add") !== (base === undefined)) {
    return null;
  }
  return base === undefined ? { key, op: "property", value } : { base, key, op: "property", value };
};
