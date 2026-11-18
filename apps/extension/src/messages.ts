import { WAITS } from "@repo/contract/rpc/call-outcome";
import { browser } from "wxt/browser";
import { z } from "zod";

export const extensionRequestSchema = z.discriminatedUnion("type", [
  z.strictObject({ tabId: z.number().int(), type: z.literal("save") }),
  z.strictObject({ type: z.literal("status") }),
  z.strictObject({ type: z.literal("refused") }),
  z.strictObject({ opId: z.string().min(1), type: z.literal("retry") }),
  z.strictObject({ opId: z.string().min(1), type: z.literal("discard") }),
]);

export type ExtensionRequest = z.infer<typeof extensionRequestSchema>;

export const OUTCOME_REASONS = [
  "not-connected",
  "signed-out",
  "unsupported-page",
  "update-extension",
  "too-large",
  "needs-connection",
  "failed",
] as const;

export type OutcomeReason = (typeof OUTCOME_REASONS)[number];

const outcomeSchema = z.discriminatedUnion("kind", [
  z.object({ created: z.boolean(), kind: z.literal("saved"), title: z.string() }),
  z.object({ kind: z.literal("queued"), waitsFor: z.enum(WAITS) }),
  z.discriminatedUnion("reason", [
    z.object({ kind: z.literal("refused"), reason: z.enum(OUTCOME_REASONS) }),
    z.object({ kind: z.literal("refused"), message: z.string(), reason: z.literal("library") }),
  ]),
]);

export type Outcome = z.infer<typeof outcomeSchema>;

const statusSchema = z.object({
  account: z.object({ email: z.string(), libraryUrl: z.string() }).nullable(),
  signInUrl: z.string(),
});

export type Status = z.infer<typeof statusSchema>;

const refusedSaveSchema = z.object({ message: z.string(), name: z.string(), opId: z.string() });

export type RefusedSave = z.infer<typeof refusedSaveSchema>;

const refusedSavesSchema = z.array(refusedSaveSchema);

export type WorkerAnswer = Outcome | Status | readonly RefusedSave[];

const SAVE_FAILED: Outcome = { kind: "refused", reason: "failed" };

const answerTo = async <T, U>(request: ExtensionRequest, schema: z.ZodType<T>, unread: U) => {
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
  readonly status: () => Promise<Status | null>;
  readonly refused: () => Promise<readonly RefusedSave[] | null>;
  readonly retry: (opId: string) => Promise<readonly RefusedSave[] | null>;
  readonly discard: (opId: string) => Promise<readonly RefusedSave[] | null>;
}

export const askWorker: WorkerAsks = {
  discard: async (opId) => await answerTo({ opId, type: "discard" }, refusedSavesSchema, null),
  refused: async () => await answerTo({ type: "refused" }, refusedSavesSchema, null),
  retry: async (opId) => await answerTo({ opId, type: "retry" }, refusedSavesSchema, null),
  save: async (tabId) => await answerTo({ tabId, type: "save" }, outcomeSchema, SAVE_FAILED),
  status: async () => await answerTo({ type: "status" }, statusSchema, null),
};
