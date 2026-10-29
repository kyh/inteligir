// the one spelling of which part of the library a screen shows: the page's pref, the items
// listing and the view context all read it, and the cell's spelling differs only in naming a
// folder by id. zod alone; a folder's path and a tag's name are held to their grammars at the wire.

import { z } from "zod";

// the kinds every spelling below shares, so a kind added here reaches each; only how a folder is
// named differs between them
const SHARED_SCOPES = [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("unsorted") }),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1) }),
] as const;

const ITEM_SCOPES = [
  ...SHARED_SCOPES,
  z.object({ kind: z.literal("folder"), path: z.string().min(1) }),
] as const;

// a scope that lists items in the library: every one but Deleted, which lists what is gone, so
// a library view context names one of these and nothing there is an item an agent acts on
export const itemScopeSchema = z.discriminatedUnion("kind", ITEM_SCOPES);
export type ItemScope = z.infer<typeof itemScopeSchema>;

export const libraryScopeSchema = z.discriminatedUnion("kind", [
  ...ITEM_SCOPES,
  z.object({ kind: z.literal("deleted") }),
]);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;

// the library cell's spelling of the same choice, its folder named by id as the cell keeps it; the
// path-keyed scopes above go with the local server's last client
export const cellItemScopeSchema = z.discriminatedUnion("kind", [
  ...SHARED_SCOPES,
  z.object({ folderId: z.string().min(1), kind: z.literal("folder") }),
]);
