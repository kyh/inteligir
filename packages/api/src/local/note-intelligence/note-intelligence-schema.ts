// Note Intelligence: the app infers a CLOSED set of frontmatter fields —
// description, tags, status — for notes that lack them, so structure emerges
// without manual tagging. Inference only ever ADDS absent fields (a user-set
// value is never rewritten), which is also what makes the background sweep
// converge: its own writes disqualify their notes from the next pass. OFF by
// default; the toggle is the whole control surface, the voice model's
// precedent.

import { z } from "zod";

/** What one finished sweep did — the Settings line's whole vocabulary. */
export const noteIntelligenceSweepSchema = z
  .object({
    /** Notes examined for absent fields. */
    scanned: z.number().int().min(0),
    /** Notes whose frontmatter gained at least one field. */
    updated: z.number().int().min(0),
    /** Candidates skipped (inference failed, or a concurrent edit refused). */
    skipped: z.number().int().min(0),
  })
  .strict();
export type NoteIntelligenceSweep = z.infer<typeof noteIntelligenceSweepSchema>;

export const noteIntelligenceStatusSchema = z
  .object({
    enabled: z.boolean(),
    /** A sweep is executing right now. */
    running: z.boolean(),
    /** The last finished sweep, or null before any ran. */
    lastSweep: noteIntelligenceSweepSchema.nullable(),
  })
  .strict();
export type NoteIntelligenceStatus = z.infer<typeof noteIntelligenceStatusSchema>;

export const noteIntelligenceToggleSchema = z.object({ enabled: z.boolean() }).strict();
export type NoteIntelligenceToggle = z.infer<typeof noteIntelligenceToggleSchema>;
