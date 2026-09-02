// rides the message, never a thread column or a mutable "current view": it describes the screen
// the message left from, so it cannot go stale and nothing has to happen on navigation. not the
// thread's `originDocPath`, which is the durable binding rebound on rename.

import { z } from "zod";

// a single-member discriminatedUnion so a second surface makes every non-exhaustive consumer a
// compile error.
export const viewContextSchema = z.discriminatedUnion("surface", [
  z.object({
    surface: z.literal("doc"),
    // held to the vault path grammar at the wire boundary; this leaf carries only zod.
    resource: z.string().min(1),
    // sha-256 hex of the note's bytes at send time.
    revision: z.string().min(1),
  }),
]);
export type ViewContext = z.infer<typeof viewContextSchema>;
