// An item's own properties as Info's rows: the fields the library holds in place of a
// frontmatter, each row typed by its value, and each edit one property op over the value the row
// showed. A value no control edits (an object, a list that is not all words) is drawn as it is.

import type { PropertyOp } from "@repo/contract/library/field-ops";
import { propertyKeySchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import { z } from "zod";

export type Properties = LibraryItemFields["properties"];

export type TypedProperty =
  | { key: string; type: "text"; value: string }
  | { key: string; type: "number"; value: number }
  | { key: string; type: "checkbox"; value: boolean }
  | { key: string; type: "date"; value: string }
  | { key: string; type: "tags"; value: string[] }
  | { key: string; type: "unsupported"; raw: string };

// a day no calendar holds (`2026-13-45`) is text: a date control would draw it empty
const calendarDate = z.iso.date();

// branch order is the precedence
const rowOf = (key: string, value: PropertyValue): TypedProperty => {
  const checkbox = z.boolean().safeParse(value);
  if (checkbox.success) {
    return { key, type: "checkbox", value: checkbox.data };
  }
  const number = z.number().safeParse(value);
  if (number.success) {
    return { key, type: "number", value: number.data };
  }
  const text = z.string().safeParse(value);
  if (text.success) {
    return calendarDate.safeParse(text.data).success
      ? { key, type: "date", value: text.data }
      : { key, type: "text", value: text.data };
  }
  const tags = z.array(z.string()).safeParse(value);
  if (tags.success) {
    return { key, type: "tags", value: tags.data };
  }
  return { key, raw: JSON.stringify(value), type: "unsupported" };
};

export const rowsOf = (properties: Properties): TypedProperty[] =>
  Object.entries(properties).map(([key, value]) => rowOf(key, value));

// the op that leaves `key` holding `value`, or nothing where none is given, over what it holds now
export const propertyOp = (
  properties: Properties,
  key: string,
  value?: PropertyValue,
): PropertyOp => {
  const op: PropertyOp = { key, op: "property" };
  if (Object.hasOwn(properties, key)) {
    op.base = properties[key];
  }
  if (value !== undefined) {
    op.value = value;
  }
  return op;
};

// the fields Info edits as the item's own, which a property of the same name would read as
const ITEM_NAMES = new Set(["title", "tags", "folder", "pinned"]);

// why a new property cannot take a name, which holds the form open on it
export const nameRefusal = (properties: Properties, name: string): string | null => {
  if (!propertyKeySchema.safeParse(name).success) {
    return "No property can take that name.";
  }
  return Object.hasOwn(properties, name) || ITEM_NAMES.has(name.toLowerCase())
    ? "This item already has one by that name."
    : null;
};
