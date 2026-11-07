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
  // let this browser's connection go
  z.strictObject({ type: z.literal("disconnect") }),
]);
export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;

// why a save did not land, each said in outcome-copy.ts
/** @internal */
export const OUTCOME_REASONS = [
  // no account connected in this browser yet
  "not-connected",
  // the account's credential was revoked or the account deleted
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
  // `created` is false for a page the library already held, which the save folded onto
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  // the cloud did not answer: the save waits and goes once it does
  z.object({ kind: z.literal("queued") }),
  z.object({ kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

const statusSchema = z.object({
  // the site's page that connects this browser to an account
  connectUrl: z.string(),
  // the connection this browser holds, the account's email, the library's address and the page
  // with Disconnect, or none
  connection: z
    .object({ email: z.string(), libraryUrl: z.string(), manageUrl: z.string() })
    .nullable(),
});
export type Status = z.infer<typeof statusSchema>;

// what the worker sends a page: a save's outcome, a status, or, for any work that failed, a refusal
export type WorkerAnswer = Outcome | Status;

const answerTo = async (request: ExtensionRequest): Promise<unknown> => {
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    return answer;
  } catch {
    return undefined;
  }
};

const statusAfter = async (request: ExtensionRequest): Promise<Status | null> => {
  const parsed = statusSchema.safeParse(await answerTo(request));
  return parsed.success ? parsed.data : null;
};

export interface WorkerAsks {
  readonly save: (tabId: number) => Promise<Outcome>;
  // null for an answer that is not a status
  readonly status: () => Promise<Status | null>;
  readonly disconnect: () => Promise<Status | null>;
}

// a page asks its worker and reads the answer; an answer that is not one is a failure to report
export const askWorker: WorkerAsks = {
  disconnect: async () => await statusAfter({ type: "disconnect" }),
  save: async (tabId) => {
    const parsed = outcomeSchema.safeParse(await answerTo({ tabId, type: "save" }));
    return parsed.success ? parsed.data : { kind: "refused", reason: "failed" };
  },
  status: async () => await statusAfter({ type: "status" }),
};
