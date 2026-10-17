// what the extension's own pages ask its service worker, and what it answers. Only the extension's
// pages send these (the worker refuses every other sender), but a message crosses as an untyped
// value, so both ends parse it.

import { BROWSER_REFUSALS } from "@repo/contract/browser/browser-wire";
import { z } from "zod";

export const extensionRequestSchema = z.discriminatedUnion("type", [
  // the tab the popup was opened over, or the one a suite names
  z.object({
    keepCopy: z.boolean().default(false),
    tabId: z.number().int(),
    type: z.literal("save"),
  }),
  z.object({ type: z.literal("hello") }),
  z.object({ type: z.literal("open-app") }),
]);
export type ExtensionRequest = z.input<typeof extensionRequestSchema>;
export type ParsedExtensionRequest = z.output<typeof extensionRequestSchema>;

// the host's refusals, and the one the browser itself answers: no app on this computer to ask
export const OUTCOME_REASONS = ["absent", ...BROWSER_REFUSALS] as const;
export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({
    created: z.boolean(),
    kind: z.literal("saved"),
    path: z.string(),
    title: z.string(),
  }),
  z.object({ appVersion: z.string(), kind: z.literal("hello"), library: z.string() }),
  z.object({ kind: z.literal("opened") }),
  z.object({ detail: z.string(), kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
]);
export type Outcome = z.infer<typeof outcomeSchema>;

export const refusedOutcome = (reason: OutcomeReason, detail = ""): Outcome => ({
  detail,
  kind: "refused",
  reason,
});

// a page asks its worker and reads the answer; an answer that is not one is a failure to report
export const askWorker = async (request: ExtensionRequest): Promise<Outcome> => {
  try {
    const answer: unknown = await chrome.runtime.sendMessage(request);
    const parsed = outcomeSchema.safeParse(answer);
    return parsed.success ? parsed.data : refusedOutcome("failed", "the extension did not answer");
  } catch (error) {
    return refusedOutcome("failed", error instanceof Error ? error.message : String(error));
  }
};
