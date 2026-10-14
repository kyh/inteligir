// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import { z } from "zod";

// the drizzle column takes the tuple and the wire schema the enum; one list so a decision cannot
// exist on only one side.
export const pendingInteractionApprovalDecisionValues = [
  "allow_once",
  "allow_for_session",
  "deny",
] as const;
export const pendingInteractionApprovalDecisionSchema = z.enum(
  pendingInteractionApprovalDecisionValues,
);
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

export interface PendingInteractionResolution {
  decision: PendingInteractionApprovalDecision;
}

// deny is always accepted (every cancel path answers with it)
export const answerableDecisions = (
  payload: ApprovalPendingInteractionPayload,
): PendingInteractionApprovalDecision[] => [
  ...payload.availableDecisions.filter((decision) => decision !== "deny"),
  "deny",
];

// the answer route's 400 gate and the runtime both run this, so an answer the route takes is never
// denied downstream. null when the request takes the decision.
export const unanswerableReason = (
  payload: ApprovalPendingInteractionPayload,
  decision: PendingInteractionApprovalDecision,
): string | null => {
  const answerable = answerableDecisions(payload);
  return answerable.includes(decision)
    ? null
    : `The request offers ${answerable.join(", ")}; "${decision}" is not among them`;
};

export interface PendingInteractionCreate {
  threadId: string;
  turnId: string;
  providerRequestId: string;
  payload: ApprovalPendingInteractionPayload;
}
