// What a shell command rejects with when it cannot do what it was asked (src-tauri/src/error.rs):
// its kind, which the page switches on, and its message, in the person's words. Every command
// answers a value or rejects with one of these; anything else a rejection carries is a fault of
// the bridge itself.

import { z } from "zod";

export const shellErrorSchema = z.strictObject({
  kind: z.enum([
    "signed-out",
    "transaction-gone",
    "missing",
    "invalid",
    "sql",
    "io",
    "keychain",
    "network",
  ]),
  message: z.string(),
});
// the shell's own kinds, and `bridge` for a rejection that is none of them: the bridge's fault
export type ShellErrorKind = z.infer<typeof shellErrorSchema>["kind"] | "bridge";

export class ShellError extends Error {
  override name = "ShellError";
  readonly kind: ShellErrorKind;
  constructor(kind: ShellErrorKind, message: string) {
    super(message);
    this.kind = kind;
  }
}

// Tauri's own refusals (a command no capability grants, arguments serde refused) reject with text
const bridgeRefusalSchema = z.string().min(1);

// a rejection as the page reads it: the shell's own error, or the bridge's fault said as one
export const shellErrorOf = (cause: unknown): ShellError => {
  const parsed = shellErrorSchema.safeParse(cause);
  if (parsed.success) {
    return new ShellError(parsed.data.kind, parsed.data.message);
  }
  const refusal = bridgeRefusalSchema.safeParse(cause);
  return new ShellError("bridge", refusal.success ? refusal.data : "The app did not answer.");
};
