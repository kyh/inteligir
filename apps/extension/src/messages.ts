// what the extension's own pages ask its service worker, and what it answers. Only the extension's
// pages send these (the worker refuses every other sender), but a message crosses as an untyped
// value, so both ends parse it.

import { browser } from "wxt/browser";
import { z } from "zod";

export const extensionRequestSchema = z.discriminatedUnion("type", [
  // the tab the popup was opened over, or the one a suite names
  z.strictObject({ tabId: z.number().int(), type: z.literal("save") }),
  // whose library this browser saves to, and where it is
  z.strictObject({ type: z.literal("status") }),
]);
export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;

// why a save did not land, each said in outcome-copy.ts
export const OUTCOME_REASONS = [
  // no account signed in here yet, or the one that was is deleted
  "not-connected",
  // the account's session ended, for a picture, which waits in no queue
  "signed-out",
  "unsupported-page",
  "update-extension",
  "library-full",
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
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(["connection", "sign-in", "update"]) }),
  z.object({ kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;
export type WaitsFor = Extract<Outcome, { kind: "queued" }>["waitsFor"];

const statusSchema = z.object({
  // the account this browser is signed in as and the library's address, or none
  account: z.object({ email: z.string(), libraryUrl: z.string() }).nullable(),
  // the site's page that signs this browser in: its sign-in, or in a dev build the connect page,
  // which comes back to tell the extension
  signInUrl: z.string(),
});
export type Status = z.infer<typeof statusSchema>;

// what the worker sends a page: a save's outcome, a status, or, for any work that failed, a refusal
export type WorkerAnswer = Outcome | Status;

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
}

export const askWorker: WorkerAsks = {
  save: async (tabId) => await answerTo({ tabId, type: "save" }, outcomeSchema, SAVE_FAILED),
  status: async () => await answerTo({ type: "status" }, statusSchema, null),
};
