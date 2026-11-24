import { z } from "zod";

import { ITEM_FIELD_CAPS } from "./items/item-field-caps";

const ITEM_SCOPES = [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("unsorted") }),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1).max(ITEM_FIELD_CAPS.line) }),
  z.object({ kind: z.literal("parent"), parentId: z.uuid() }),
] as const;

export const itemScopeSchema = z.discriminatedUnion("kind", ITEM_SCOPES);

export const libraryScopeSchema = z.discriminatedUnion("kind", [
  ...ITEM_SCOPES,
  z.object({ kind: z.literal("deleted") }),
]);

export type LibraryScope = z.infer<typeof libraryScopeSchema>;

const EVERY_ITEM: LibraryScope = { kind: "all" };

export const listedScope = (scope: LibraryScope, folders: readonly { readonly id: string }[]) =>
  scope.kind === "parent" && !folders.some((folder) => folder.id === scope.parentId)
    ? EVERY_ITEM
    : scope;

export const LIBRARY_SELECTION_MAX = 200;
