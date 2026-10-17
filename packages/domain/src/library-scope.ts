// the one spelling of which part of the library a screen shows: the page's pref, the items
// listing and the view context all read it. zod alone; a folder's path and a tag's name are held
// to their grammars at the wire.

import { z } from "zod";

export const libraryScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("all") }),
  z.object({ kind: z.literal("unsorted") }),
  z.object({ kind: z.literal("folder"), path: z.string().min(1) }),
  z.object({ kind: z.literal("tag"), tag: z.string().min(1) }),
  z.object({ kind: z.literal("deleted") }),
]);
export type LibraryScope = z.infer<typeof libraryScopeSchema>;
