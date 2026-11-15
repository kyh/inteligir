// An item's own properties as Info's rows: the fields the library holds in place of a
// frontmatter, each row typed by its value as an imported file's key is, and each edit one
// property op over the value the row showed. A value no control edits (an object, a list that is
// not all words) is drawn as it is.

import type { PropertyOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields, PropertyValue } from "@repo/contract/library/library-item";
import { classify } from "@repo/editor/markdown/frontmatter";
import type { TypedProperty } from "@repo/editor/markdown/frontmatter";

export type Properties = LibraryItemFields["properties"];

export const rowsOf = (properties: Properties): TypedProperty[] =>
  Object.entries(properties).map(([key, value]) => classify(key, value, JSON.stringify(value)));

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
export const nameRefusal = (properties: Properties, name: string): string | null =>
  Object.hasOwn(properties, name) || ITEM_NAMES.has(name.toLowerCase())
    ? "This item already has one by that name."
    : null;
