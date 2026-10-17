// rides the message, never a thread column or a mutable "current view": it describes the screen
// the message left from, so it cannot go stale and nothing has to happen on navigation. not the
// thread's `originDocPath`, the durable binding resolved by the note's frontmatter id.

import { z } from "zod";

import { libraryScopeSchema } from "./library-scope";

export const docViewContextSchema = z.object({
  // held to the vault path grammar at the wire boundary; this leaf carries only zod.
  resource: z.string().min(1),
  // sha-256 hex of the note's bytes at send time.
  revision: z.string().min(1),
  surface: z.literal("doc"),
});
export type DocViewContext = z.infer<typeof docViewContextSchema>;

// the most selected paths a message names; `selected` says how many there were
export const LIBRARY_SELECTION_MAX = 200;

// the library grid: its scope, its filters and its selection. the thread event records it with
// `paths: []`, since the event rides the thread sync under a size cap and only the prompt reads
// the paths.
export const libraryViewContextSchema = z.object({
  // refined to item kinds at the wire
  kinds: z.array(z.string().min(1)).min(1).optional(),
  // the first selected; [] when nothing is selected
  paths: z.array(z.string().min(1)).max(LIBRARY_SELECTION_MAX),
  q: z.string().min(1).optional(),
  // never "deleted"; refined at the wire
  scope: libraryScopeSchema,
  // how many are selected, which may exceed paths.length
  selected: z.number().int().min(0),
  surface: z.literal("library"),
});
export type LibraryViewContext = z.infer<typeof libraryViewContextSchema>;

// a discriminated union so a further surface makes every non-exhaustive consumer a compile error.
export const viewContextSchema = z.discriminatedUnion("surface", [
  docViewContextSchema,
  libraryViewContextSchema,
]);
export type ViewContext = z.infer<typeof viewContextSchema>;
