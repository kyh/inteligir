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

const outcomeSchema = z.discriminatedUnion("kind", [
  // `created` is false for a page the library already held, which the save folded onto
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  // the cloud did not answer: the save waits and goes once it does
  z.object({ kind: z.literal("queued") }),
  z.object({ kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
  // the connection this browser holds, the account's email and the library's address, or none
  z.object({
    // the site's page that connects this browser to an account
    connectUrl: z.string(),
    connection: z.object({ email: z.string(), libraryUrl: z.string() }).nullable(),
    kind: z.literal("status"),
  }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

// a page asks its worker and reads the answer; an answer that is not one is a failure to report
export const askWorker = async (request: ExtensionRequest): Promise<Outcome> => {
  try {
    const answer: unknown = await browser.runtime.sendMessage(request);
    const parsed = outcomeSchema.safeParse(answer);
    return parsed.success ? parsed.data : { kind: "refused", reason: "failed" };
  } catch {
    return { kind: "refused", reason: "failed" };
  }
};
