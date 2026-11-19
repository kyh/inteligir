import type { BodyBlock } from "./derive-item";

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

export type NoteSaved =
  | { readonly kind: "saved"; readonly version: number }
  | { readonly kind: "stale" }
  | { readonly kind: "full" }
  | { readonly kind: "deleted" }
  | { readonly kind: "missing" }
  | { readonly kind: "file-missing" };
