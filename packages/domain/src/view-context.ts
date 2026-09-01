// What the sender was looking at when they pressed Enter. It rides the
// MESSAGE — never a thread column, never a mutable server-side "current view".
//
// A view context is a statement about the PAST: it describes the screen the
// message left from, which is exactly what "this", "here" and "the note" in
// that message refer to. That is what makes it immune to staleness rather than
// in need of a fix for it — nothing has to happen when the user navigates away
// mid-turn, because the value never claimed to describe the present. A mutable
// "current view" would have neither owner nor truth (two windows, a closed tab,
// a turn still running after the app quit) and would be a lie the first time
// anyone stopped looking.
//
// Not the thread's `originDocPath` either: that is the DURABLE binding of an
// action to the note it was composed over, rebound on rename. Two spellings of
// "which doc is this about" is the confusion CONTEXT.md exists to prevent.

import { z } from "zod";

/**
 * A single-member `discriminatedUnion` rather than a bare literal: adding a
 * second surface then makes every non-exhaustive consumer a compile error, and
 * the wire stays additive.
 */
export const viewContextSchema = z.discriminatedUnion("surface", [
  z.object({
    surface: z.literal("doc"),
    /** The vault-relative path. Held to the vault path grammar at the WIRE
     *  boundary, where that grammar lives — this leaf carries zod and nothing
     *  else, so it can only ask for a non-empty string. */
    resource: z.string().min(1),
    /** sha-256 hex of the note's bytes when the message was sent. */
    revision: z.string().min(1),
  }),
]);
export type ViewContext = z.infer<typeof viewContextSchema>;
