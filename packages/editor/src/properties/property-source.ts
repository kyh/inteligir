// Where the properties panel reads its rows and writes a row's change: a note's frontmatter in its
// live editor, or an item's own fields (`@repo/editor/item/item-properties`). The panel draws
// either the same way; the source decides what a row is and where its edit lands, applied to the
// properties as they stand when it lands rather than to the list the render drew.

import type { SlateEditor } from "platejs";

import { ITEM_KEYS } from "@repo/notes/items/item-kind";
import { parseProperties, serializeProperties } from "@repo/notes/markdown/frontmatter";
import type { ParsedProperties, TypedProperty } from "@repo/notes/markdown/frontmatter";

import { subscribeLiveEditors } from "@repo/editor/live-editor";
import { readFrontmatterRaw, writeFrontmatterRaw } from "@repo/editor/properties/properties-node";

// one row's change: a pin, an undo or the previous edit may have moved the rows since it was drawn
export type PropertyEdit =
  | { readonly kind: "set"; readonly prop: TypedProperty }
  | { readonly kind: "remove"; readonly key: string }
  | { readonly kind: "add"; readonly prop: TypedProperty };

// `snapshot` answers the same value while nothing changed, as useSyncExternalStore asks, and
// `read` the rows it holds
export interface PropertySource<S> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly snapshot: () => S;
  readonly read: (snapshot: S) => ParsedProperties;
  readonly commit: (edit: PropertyEdit) => void;
}

const hasKey = (properties: readonly TypedProperty[], key: string): boolean =>
  properties.some((p) => p.key === key);

// null when the edit no longer applies: its row is gone, or the key it adds exists (a duplicate
// key would make the whole block invalid)
export const applyPropertyEdit = (
  properties: readonly TypedProperty[],
  edit: PropertyEdit,
): TypedProperty[] | null => {
  switch (edit.kind) {
    case "set": {
      return hasKey(properties, edit.prop.key)
        ? properties.map((p) => (p.key === edit.prop.key ? edit.prop : p))
        : null;
    }
    case "remove": {
      return hasKey(properties, edit.key) ? properties.filter((p) => p.key !== edit.key) : null;
    }
    case "add": {
      return hasKey(properties, edit.prop.key) ? null : [...properties, edit.prop];
    }
    default: {
      const exhaustive: never = edit;
      return exhaustive;
    }
  }
};

const HIDDEN_KEYS: ReadonlySet<string> = new Set<string>([...ITEM_KEYS, "id"]);

// a note's frontmatter, less the item's own keys and its id, which Info reads from the index;
// read from its live editor, outside the Plate tree, so the live-editor channel carries its edits
export const frontmatterProperties = (editor: SlateEditor): PropertySource<string | null> => ({
  commit: (edit) => {
    const current = readFrontmatterRaw(editor) ?? "";
    const fresh = parseProperties(current);
    if (fresh.kind === "invalid") {
      return;
    }
    const next = applyPropertyEdit(fresh.kind === "valid" ? fresh.properties : [], edit);
    if (next !== null) {
      writeFrontmatterRaw(editor, serializeProperties(next, current));
    }
  },
  read: (raw) => {
    if (raw === null) {
      return { kind: "none" };
    }
    const parsed = parseProperties(raw);
    return parsed.kind === "valid"
      ? {
          kind: "valid",
          properties: parsed.properties.filter((prop) => !HIDDEN_KEYS.has(prop.key)),
        }
      : parsed;
  },
  snapshot: () => readFrontmatterRaw(editor),
  subscribe: subscribeLiveEditors,
});
