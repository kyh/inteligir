// The spell checker belongs to the window's session, so main applies it and the page
// mirrors the result: plain values parsed on both sides of the bridge, like the updater's.

import { z } from "zod";

export const spellcheckChoiceSchema = z
  .object({
    enabled: z.boolean(),
    // [] keeps the session's own list, which Chromium derives from the OS locale
    languages: z.array(z.string().min(1)),
  })
  .strict();
export type SpellcheckChoice = z.infer<typeof spellcheckChoiceSchema>;

export const spellcheckStateSchema = z
  .object({
    enabled: z.boolean(),
    languages: z.array(z.string()),
    available: z.array(z.string()),
    // false on macOS: the OS checker picks languages itself and the session's setter is a no-op
    languagesConfigurable: z.boolean(),
  })
  .strict();
export type SpellcheckState = z.infer<typeof spellcheckStateSchema>;
