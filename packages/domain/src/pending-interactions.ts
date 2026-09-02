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
  kind: z.literal("command"),
  itemId: z.string().min(1),
  command: z.string().min(1),
  cwd: z.string().nullable(),
});

export const pendingInteractionFileChangeApprovalSubjectSchema = z.object({
  kind: z.literal("file_change"),
  itemId: z.string().min(1),
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
  kind: z.literal("approval"),
  subject: pendingInteractionApprovalSubjectSchema,
  reason: z.string().nullable(),
  availableDecisions: z.array(pendingInteractionApprovalDecisionSchema).min(1),
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

// one parser for the answer route's 400 gate and the runtime. deny is always accepted (every
// cancel path answers with it); any other decision must be one the request offered.
export function parseApprovalResolution(
  raw: string,
  payload: ApprovalPendingInteractionPayload,
): ApprovalResolutionParse {
  const trimmed = raw.trim();
  let parsed: ApprovalPendingInteractionResolution;
  if (trimmed === "deny" || trimmed === "allow_once" || trimmed === "allow_for_session") {
    parsed = { decision: trimmed };
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
  if (parsed.decision !== "deny" && !payload.availableDecisions.includes(parsed.decision)) {
    return {
      ok: false,
      reason: `The request offers ${payload.availableDecisions.join(", ")}; "${parsed.decision}" is not among them`,
    };
  }
  return { ok: true, resolution: parsed };
}

export interface PendingInteractionCreate {
  threadId: string;
  turnId: string;
  providerId: string;
  providerThreadId: string;
  providerRequestId: string;
  payload: ApprovalPendingInteractionPayload;
}
