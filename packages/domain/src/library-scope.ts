// The one spelling of which part of the library a screen shows: the page's pref, the replica's
// listing and the view context a message to the built-in agent carries all read it, a folder named
// by its id as the account's cell keeps it. zod alone; a tag's name is held to its grammar at the
// wire.

import { z } from "zod";

// a scope that lists items in the library: every one but Deleted, which lists what is gone, so a
// view context names one of these and nothing there is an item an agent acts on
const ITEM_SCOPES = [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("unsorted") }),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1) }),
  z.object({ folderId: z.string().min(1), kind: z.literal("folder") }),
] as const;

export const itemScopeSchema = z.discriminatedUnion("kind", ITEM_SCOPES);

// a scope the library's page shows: every item scope, and Deleted
export const libraryScopeSchema = z.discriminatedUnion("kind", [
  ...ITEM_SCOPES,
  z.object({ kind: z.literal("deleted") }),
]);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

// the most of a scope's selected items a message names; it says how many there were beside them
export const LIBRARY_SELECTION_MAX = 200;
