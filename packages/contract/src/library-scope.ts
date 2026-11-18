// The one spelling of which part of the library a screen shows: the library tab's address, the
// cell's listing and the view context a message to the built-in agent carries all read it, a folder
// named by its id as the account's cell keeps it. A tag no item carries lists nothing, so its name
// is held to no grammar here, only to the line a tag's length is.

import { z } from "zod";

import { ITEM_FIELD_CAPS } from "./library/library-item";

// a scope that lists items in the library: every one but Deleted, which lists what is gone, so a
// view context names one of these and nothing there is an item an agent acts on
const ITEM_SCOPES = [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("unsorted") }),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1).max(ITEM_FIELD_CAPS.line) }),
  z.object({ folderId: z.uuid(), kind: z.literal("folder") }),
] as const;

export const itemScopeSchema = z.discriminatedUnion("kind", ITEM_SCOPES);

// a scope the library's page shows: every item scope, and Deleted
export const libraryScopeSchema = z.discriminatedUnion("kind", [
  ...ITEM_SCOPES,
  z.object({ kind: z.literal("deleted") }),
]);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

const EVERY_ITEM: LibraryScope = { kind: "all" };

// a scope a screen keeps, as the library reads it now: a folder the library no longer lists (one
// another device deleted) reads as every item, so nothing lists under it or saves into it
export const listedScope = (
  scope: LibraryScope,
  folders: readonly { readonly id: string }[],
): LibraryScope =>
  scope.kind === "folder" && !folders.some((folder) => folder.id === scope.folderId)
    ? EVERY_ITEM
    : scope;

// the most of a scope's selected items a message names; it says how many there were beside them
export const LIBRARY_SELECTION_MAX = 200;
