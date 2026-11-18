// A note's body as a device edits it whole: what it reads (`items.get`), what a save carries over
// the version it read (`items.saveBody`), and what the save made of it, in the terms every host
// hands the editor.

import type { BodyBlock } from "./derive-item";

// its blocks at their version, the title a copy of them goes by, and whether it is in Deleted
export interface HeldNote {
  readonly blocks: readonly BodyBlock[];
  readonly version: number;
  readonly title: string;
  readonly deleted: boolean;
}

export interface NoteSave {
  readonly id: string;
  readonly baseVersion: number;
  readonly blocks: readonly BodyBlock[];
}

// `saved` at its new version; `stale`, someone saved since its base; `full`, past the most a note
// holds; `deleted`, in Deleted; `missing`, the item gone
export type NoteSaved =
  | { readonly kind: "saved"; readonly version: number }
  | { readonly kind: "stale" }
  | { readonly kind: "full" }
  | { readonly kind: "deleted" }
  | { readonly kind: "missing" };
