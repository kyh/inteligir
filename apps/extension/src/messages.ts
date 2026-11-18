// what the extension's own pages ask its service worker, and what it answers. Only the extension's
// pages send these (the worker refuses every other sender), but a message crosses as an untyped
// value, so both ends parse it.

import { WAITS } from "@repo/contract/rpc/call-outcome";
import { browser } from "wxt/browser";
import { z } from "zod";

export const extensionRequestSchema = z.discriminatedUnion("type", [
  // the tab the popup was opened over, or the one a suite names
  z.strictObject({ tabId: z.number().int(), type: z.literal("save") }),
  // whose library this browser saves to, and where it is
  z.strictObject({ type: z.literal("status") }),
  // the saves the account signed in keeps: those its library refused, and how many wait
  z.strictObject({ type: z.literal("saves") }),
  // a refused one sent again, or let go
  z.strictObject({ opId: z.string().min(1), type: z.literal("retry") }),
  z.strictObject({ opId: z.string().min(1), type: z.literal("discard") }),
]);
export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;

// why the extension did not save, each said in outcome-copy.ts
export const OUTCOME_REASONS = [
  // no account signed in here yet, or the one that was is deleted
  "not-connected",
  // the account's session ended, for a picture, which waits in no queue
  "signed-out",
  "unsupported-page",
  "update-extension",
  "too-large",
  // a picture's bytes, which wait for no connection
  "needs-connection",
  "failed",
] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

// how a save went
const outcomeSchema = z.discriminatedUnion("kind", [
  // `created` is false for a page the library already held, which the save answered with
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  // the save waits and goes once the cloud answers, once its account signs in again, or once the
  // browser updates the extension
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(WAITS) }),
  z.discriminatedUnion("reason", [
    z.object({ kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
    // the library's own no, in its words; a page or a link it refused waits among `refused`
    z.object({ kind: z.literal("refused"), message: z.string(), reason: z.literal("library") }),
  ]),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

const statusSchema = z.object({
  // the account this browser is signed in as and the library's address, or none
  account: z.object({ email: z.string(), libraryUrl: z.string() }).nullable(),
  // the site's sign-in, which signs this browser in
  signInUrl: z.string(),
});
export type Status = z.infer<typeof statusSchema>;

// a save the library refused, kept until the person sends it again or lets it go: the page's
// title, or its address where none was read, and the library's words
const refusedSaveSchema = z.object({ message: z.string(), name: z.string(), opId: z.string() });
export type RefusedSave = z.infer<typeof refusedSaveSchema>;

// the saves the account signed in keeps that its library has not taken: each address it refused,
// once, and how many saves wait to be sent
const heldSavesSchema = z.object({
  refused: z.array(refusedSaveSchema).readonly(),
  waiting: z.number().int().nonnegative(),
});
export type HeldSaves = z.infer<typeof heldSavesSchema>;

// what the worker sends a page: a save's outcome, a status, the held saves, or, for any work that
// failed, a refusal
export type WorkerAnswer = Outcome | Status | HeldSaves;

const SAVE_FAILED: Outcome = { kind: "refused", reason: "failed" };

// a page asks its worker and reads the answer; an answer that is not one is `unread`, a failure to
// report
const answerTo = async <T, U>(
  request: ExtensionRequest,
  schema: z.ZodType<T>,
  unread: U,
): Promise<T | U> => {
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    const parsed = schema.safeParse(answer);
    return parsed.success ? parsed.data : unread;
  } catch {
    return unread;
  }
};

export interface WorkerAsks {
  readonly save: (tabId: number) => Promise<Outcome>;
  // null for an answer that is not a status
  readonly status: () => Promise<Status | null>;
  // the held saves as they stand, as a pass that sent a refused one again left them, and without
  // the one let go; null for an answer that is not them
  readonly saves: () => Promise<HeldSaves | null>;
  readonly retry: (opId: string) => Promise<HeldSaves | null>;
  readonly discard: (opId: string) => Promise<HeldSaves | null>;
}

export const askWorker: WorkerAsks = {
  discard: async (opId) => await answerTo({ opId, type: "discard" }, heldSavesSchema, null),
  retry: async (opId) => await answerTo({ opId, type: "retry" }, heldSavesSchema, null),
  save: async (tabId) => await answerTo({ tabId, type: "save" }, outcomeSchema, SAVE_FAILED),
  saves: async () => await answerTo({ type: "saves" }, heldSavesSchema, null),
  status: async () => await answerTo({ type: "status" }, statusSchema, null),
};
