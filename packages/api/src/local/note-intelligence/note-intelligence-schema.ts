// inference only ever adds absent frontmatter fields, never rewrites a set one; that is what
// makes the sweep converge, since its own writes disqualify their notes from the next pass.

import { z } from "zod";

export const noteIntelligenceSweepSchema = z
  .object({
    scanned: z.number().int().min(0),
    updated: z.number().int().min(0),
    skipped: z.number().int().min(0),
  })
  .strict();
export type NoteIntelligenceSweep = z.infer<typeof noteIntelligenceSweepSchema>;

// inference runs a vendor cli: a 0 that means "nothing to do" and a 0 that means "nothing can be done" are not the same number
export const noteIntelligenceAvailabilitySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("available") }).strict(),
  z.object({ kind: z.literal("unavailable"), detail: z.string().min(1) }).strict(),
]);
export type NoteIntelligenceAvailability = z.infer<typeof noteIntelligenceAvailabilitySchema>;

export const noteIntelligenceStatusSchema = z
  .object({
    availability: noteIntelligenceAvailabilitySchema,
    enabled: z.boolean(),
    running: z.boolean(),
    lastSweep: noteIntelligenceSweepSchema.nullable(),
  })
  .strict();
export type NoteIntelligenceStatus = z.infer<typeof noteIntelligenceStatusSchema>;

export const noteIntelligenceToggleSchema = z.object({ enabled: z.boolean() }).strict();
export type NoteIntelligenceToggle = z.infer<typeof noteIntelligenceToggleSchema>;
