// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

export const pendingInteractionApprovalDecisionSchema = z.enum([
  "allow_once",
  "allow_for_session",
  "deny",
]);
export type PendingInteractionApprovalDecision = z.infer<
  typeof pendingInteractionApprovalDecisionSchema
>;

export const pendingInteractionCommandApprovalSubjectSchema = z.object({
  command: z.string().min(1),
  cwd: z.string().nullable(),
  itemId: z.string().min(1),
  kind: z.literal("command"),
});

export const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  itemId: z.string().min(1),
  kind: z.literal("file_change"),
  writeScope: z.string().min(1).nullable(),
});

export const pendingInteractionApprovalSubjectSchema = z.discriminatedUnion("kind", [
  pendingInteractionCommandApprovalSubjectSchema,
  pendingInteractionFileChangeApprovalSubjectSchema,
]);
export type PendingInteractionApprovalSubject = z.infer<
  typeof pendingInteractionApprovalSubjectSchema
>;

export const approvalPendingInteractionPayloadSchema = z.object({
  availableDecisions: z.array(pendingInteractionApprovalDecisionSchema).min(1),
  kind: z.literal("approval"),
  reason: z.string().nullable(),
  subject: pendingInteractionApprovalSubjectSchema,
});
export type ApprovalPendingInteractionPayload = z.infer<
  typeof approvalPendingInteractionPayloadSchema
>;

export type PendingInteractionPayload = z.infer<typeof approvalPendingInteractionPayloadSchema>;

export const approvalPendingInteractionResolutionSchema = z.object({
  decision: pendingInteractionApprovalDecisionSchema,
});
export type ApprovalPendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export type PendingInteractionResolution = z.infer<
  typeof approvalPendingInteractionResolutionSchema
>;

export type ApprovalResolutionParse =
  | { ok: true; resolution: ApprovalPendingInteractionResolution }
  | { ok: false; reason: string };

// deny is always accepted (every cancel path answers with it)
export const answerableDecisions = (
  payload: ApprovalPendingInteractionPayload,
): PendingInteractionApprovalDecision[] => [
  ...payload.availableDecisions.filter((decision) => decision !== "deny"),
  "deny",
];

// one parser for the answer route's 400 gate and the runtime: the decision must be answerable.
export const parseApprovalResolution = (
  raw: string,
  payload: ApprovalPendingInteractionPayload,
): ApprovalResolutionParse => {
  const trimmed = raw.trim();
  let parsed: ApprovalPendingInteractionResolution;
  const bare = pendingInteractionApprovalDecisionSchema.safeParse(trimmed);
  if (bare.success) {
    parsed = { decision: bare.data };
  } else {
    let json: unknown;
    try {
      json = JSON.parse(trimmed);
    } catch {
      return { ok: false, reason: "The resolution names no known decision" };
    }
    const result = approvalPendingInteractionResolutionSchema.safeParse(json);
    if (!result.success) {
      return {
        ok: false,
        reason: `The resolution does not match the approval grammar: ${
          result.error.issues[0]?.message ?? "invalid shape"
        }`,
      };
    }
    parsed = result.data;
  }
  const answerable = answerableDecisions(payload);
  if (!answerable.includes(parsed.decision)) {
    return {
      ok: false,
      reason: `The request offers ${answerable.join(", ")}; "${parsed.decision}" is not among them`,
    };
  }
  return { ok: true, resolution: parsed };
};

export interface PendingInteractionCreate {
  threadId: string;
  turnId: string;
  providerId: string;
  providerThreadId: string;
  providerRequestId: string;
  payload: ApprovalPendingInteractionPayload;
}
