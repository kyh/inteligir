// Where the properties panel reads its rows and writes a row's change: an item's own fields
// (`@repo/editor/item/item-properties`). The source decides what a row is and where its edit
// lands, applied to the properties as they stand when it lands rather than to the list the render
// drew.

import type { TypedProperty } from "@repo/editor/markdown/frontmatter";

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
  readonly read: (snapshot: S) => readonly TypedProperty[];
  readonly commit: (edit: PropertyEdit) => void;
}
