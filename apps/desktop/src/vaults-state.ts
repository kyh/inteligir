// Which vault the shell is on, which it remembers, and whether it may switch: plain values
// parsed on both sides of the bridge, like the updater's and the spell checker's.

import { z } from "zod";

const vaultRefSchema = z
  .object({
    name: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();
export type VaultRef = z.infer<typeof vaultRefSchema>;

export const vaultsStateSchema = z
  .object({
    // null when a switch would be honoured; else why the page offers no picker
    blocked: z.string().nullable(),
    current: vaultRefSchema,
    // the others, newest first; the current one is never in it
    recent: z.array(vaultRefSchema),
  })
  .strict();
export type VaultsState = z.infer<typeof vaultsStateSchema>;

export const vaultPathSchema = z.string().min(1);
