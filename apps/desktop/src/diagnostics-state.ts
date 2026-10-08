// Whether the server the shell starts traces its decisions, and whether the one running does:
// plain values the page parses off the shell's answers, like the updater's.

import { z } from "zod";

// the shell's own file and the frame that changes it, so the two cannot drift
export const diagnosticsChoiceSchema = z.object({ debug: z.boolean() }).strict();

export const diagnosticsStateSchema = z.discriminatedUnion("server", [
  z
    .object({
      // the choice the next server this shell forks runs with
      debug: z.boolean(),
      // the running server booted with the other choice
      restartRequired: z.boolean(),
      // false in a development shell, which `tauri dev` started and a relaunch would orphan
      canRestart: z.boolean(),
      server: z.literal("owned"),
    })
    .strict(),
  // started outside the app: neither the choice nor a restart reaches it
  z
    .object({
      debug: z.boolean(),
      reason: z.string().min(1),
      server: z.literal("adopted"),
    })
    .strict(),
]);
export type DiagnosticsState = z.infer<typeof diagnosticsStateSchema>;

export const diagnosticsAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true), state: diagnosticsStateSchema }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type DiagnosticsAnswer = z.infer<typeof diagnosticsAnswerSchema>;
