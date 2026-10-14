// Whether the server the shell starts traces its decisions, and whether the one running does:
// plain values the page parses off the shell's answers, like the updater's and the vaults'.

import { z } from "zod";

// the shell's own file and the frame that changes it, so the two cannot drift
export const diagnosticsChoiceSchema = z.strictObject({ debug: z.boolean() });

export const diagnosticsStateSchema = z.discriminatedUnion("server", [
  z.strictObject({
    // the choice the next server this shell forks runs with
    debug: z.boolean(),
    // the running server booted with the other choice
    restartRequired: z.boolean(),
    // false in a development shell, which `tauri dev` started and a relaunch would orphan
    canRestart: z.boolean(),
    server: z.literal("owned"),
  }),
  // started outside the app: neither the choice nor a restart reaches it
  z.strictObject({
    debug: z.boolean(),
    reason: z.string().min(1),
    server: z.literal("adopted"),
  }),
]);
export type DiagnosticsState = z.infer<typeof diagnosticsStateSchema>;
