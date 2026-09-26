import {
  approvalPendingInteractionPayloadSchema,
  pendingInteractionApprovalDecisionSchema,
} from "@repo/domain/pending-interactions";
import { viewContextSchema } from "@repo/domain/view-context";
import { z } from "zod";
import { exceedsUtf8Bytes } from "../bytes";
import { vaultPathSchema } from "../vault/vault-schema";

// The phone asks a Mac's agent through this inbox, beside captures, because it never pushes to
// the thread log. Two kinds of row ride it from the phone: a `turn`, which any Mac may claim and
// the first claim wins, and an `answer` to an approval, which only the Mac that asked may claim.
// The approvals themselves ride the other way, opened by that Mac and listed for the phone.
// Delivery is at-least-once to a claimant and a row is settled only by the claim that holds it,
// so a Mac's apply must be exactly-once on the dispatch id. An unclaimed row waits until a Mac
// claims it or the phone cancels it.

export { answerableDecisions } from "@repo/domain/pending-interactions";

export const DISPATCH_API_PATHS = {
  ack: "/v1/sync/dispatch/ack",
  approval: "/v1/sync/dispatch/approval",
  approvalClose: "/v1/sync/dispatch/approval/close",
  approvals: "/v1/sync/dispatch/approvals",
  cancel: "/v1/sync/dispatch/cancel",
  claim: "/v1/sync/dispatch/claim",
  dispatch: "/v1/sync/dispatch",
  status: "/v1/sync/dispatch/status",
} as const;

// an apply is one local transaction, so a live claimant settles well inside it; a dead one costs
// the phone this wait before another Mac may take the row
export const DISPATCH_CLAIM_TTL_MS = 2 * 60_000;
// rows waiting for a Mac at once, per account: past it a create answers rate-limited
export const DISPATCH_MAX_PENDING = 100;
export const DISPATCH_CLAIM_DEFAULT_LIMIT = 20;
// at three UTF-8 bytes a unit, the request row a Mac writes stays inside the log's event ceiling
export const DISPATCH_MAX_CHARS = 10_000;
export const DISPATCH_MESSAGE_MAX_CHARS = 1000;
export const APPROVAL_MAX_OPEN = 100;
export const APPROVAL_MAX_BYTES = 16 * 1024;

// minted by the client, 128 random bits: the id is the idempotency key, so a resend is one row
export const dispatchIdSchema = z
  .string()
  .regex(/^[0-9a-f]{32}$/u, "must be 32 lowercase hex characters");

const threadIdSchema = z.string().min(1).max(128);
const turnIdSchema = z.string().min(1).max(128);
const createdAtSchema = z.number().int().nonnegative();

// the resource reaches a Mac's prompt with no further check, so it is held to the vault path
// grammar here; the revision is the sha-256 of the bytes the phone showed
const wireViewContextSchema = viewContextSchema.superRefine((value, ctx) => {
  if (!vaultPathSchema.safeParse(value.resource).success) {
    ctx.addIssue({
      code: "custom",
      message: "viewContext.resource is not a vault path",
      path: ["resource"],
    });
  }
  if (!/^[0-9a-f]{64}$/u.test(value.revision)) {
    ctx.addIssue({
      code: "custom",
      message: "viewContext.revision is not a sha-256 hex digest",
      path: ["revision"],
    });
  }
});

const turnFields = {
  originDocPath: vaultPathSchema.optional(),
  text: z.string().min(1).max(DISPATCH_MAX_CHARS),
  threadId: threadIdSchema,
  viewContext: wireViewContextSchema.optional(),
};

const answerFields = {
  approvalId: dispatchIdSchema,
  decision: pendingInteractionApprovalDecisionSchema,
};

export const createDispatchRequestSchema = z.discriminatedUnion("kind", [
  z.object({ id: dispatchIdSchema, kind: z.literal("turn"), ...turnFields }).strict(),
  z.object({ id: dispatchIdSchema, kind: z.literal("answer"), ...answerFields }).strict(),
]);
export type CreateDispatchRequest = z.infer<typeof createDispatchRequestSchema>;

// waiting: no live claim; claimed: a Mac holds it now; delivered: a Mac took it into the thread,
// run or queued; refused: a Mac would not, and says why; unknown: cancelled, pruned or never sent
export const dispatchStatusSchema = z.discriminatedUnion("state", [
  z.object({
    id: dispatchIdSchema,
    state: z.enum(["waiting", "claimed", "delivered", "unknown"]),
  }),
  z.object({ id: dispatchIdSchema, message: z.string(), state: z.literal("refused") }),
]);
export type DispatchStatus = z.infer<typeof dispatchStatusSchema>;

export const createDispatchResponseSchema = z.object({
  dispatch: dispatchStatusSchema,
  duplicate: z.boolean(),
});
export type CreateDispatchResponse = z.infer<typeof createDispatchResponseSchema>;

export const claimDispatchesRequestSchema = z
  .object({
    limit: z.number().int().min(1).max(DISPATCH_MAX_PENDING).default(DISPATCH_CLAIM_DEFAULT_LIMIT),
  })
  .strict();
export type ClaimDispatchesRequest = z.infer<typeof claimDispatchesRequestSchema>;

export const claimedDispatchSchema = z.discriminatedUnion("kind", [
  z.object({
    createdAt: createdAtSchema,
    id: dispatchIdSchema,
    kind: z.literal("turn"),
    ...turnFields,
  }),
  z.object({
    createdAt: createdAtSchema,
    id: dispatchIdSchema,
    kind: z.literal("answer"),
    threadId: threadIdSchema,
    ...answerFields,
  }),
]);
export type ClaimedDispatch = z.infer<typeof claimedDispatchSchema>;

export const claimDispatchesResponseSchema = z.object({
  // answered even with no rows: a nullable token is a branch every client must write
  claimToken: z.string().min(1),
  dispatches: z.array(claimedDispatchSchema).max(DISPATCH_MAX_PENDING),
  expiresAt: z.number().int().positive(),
});
export type ClaimDispatchesResponse = z.infer<typeof claimDispatchesResponseSchema>;

export const dispatchResultSchema = z.discriminatedUnion("outcome", [
  z.object({ id: dispatchIdSchema, outcome: z.literal("delivered") }).strict(),
  z
    .object({
      id: dispatchIdSchema,
      message: z.string().trim().min(1).max(DISPATCH_MESSAGE_MAX_CHARS),
      outcome: z.literal("refused"),
    })
    .strict(),
]);
export type DispatchResult = z.infer<typeof dispatchResultSchema>;

export const ackDispatchesRequestSchema = z
  .object({
    claimToken: z.string().min(1),
    results: z.array(dispatchResultSchema).min(1).max(DISPATCH_MAX_PENDING),
  })
  .strict();
export type AckDispatchesRequest = z.infer<typeof ackDispatchesRequestSchema>;

// recorded: this claim settled the row, a replayed ack included; reclaimed: the claim lapsed and
// another Mac holds or settled the row, so it may run there too; unknown: cancelled, pruned or
// never sent
export const ackDispatchesResponseSchema = z.object({
  results: z
    .array(
      z.object({
        id: dispatchIdSchema,
        outcome: z.enum(["recorded", "reclaimed", "unknown"]),
      }),
    )
    .max(DISPATCH_MAX_PENDING),
});
export type AckDispatchesResponse = z.infer<typeof ackDispatchesResponseSchema>;

export const dispatchStatusRequestSchema = z
  .object({ ids: z.array(dispatchIdSchema).min(1).max(DISPATCH_MAX_PENDING) })
  .strict();
export type DispatchStatusRequest = z.infer<typeof dispatchStatusRequestSchema>;

export const dispatchStatusResponseSchema = z.object({
  // the phone's "open inteligir on your Mac" when this is 0: no computer is listening now
  desktopsOnline: z.number().int().nonnegative(),
  dispatches: z.array(dispatchStatusSchema).max(DISPATCH_MAX_PENDING),
});
export type DispatchStatusResponse = z.infer<typeof dispatchStatusResponseSchema>;

export const cancelDispatchRequestSchema = z.object({ id: dispatchIdSchema }).strict();
export type CancelDispatchRequest = z.infer<typeof cancelDispatchRequestSchema>;

// cancelled: removed before any Mac held it; claimed: a Mac holds it now; settled: delivered or
// refused already
export const cancelDispatchResponseSchema = z.object({
  outcome: z.enum(["cancelled", "claimed", "settled", "unknown"]),
});
export type CancelDispatchResponse = z.infer<typeof cancelDispatchResponseSchema>;

export const approvalPayloadSchema = approvalPendingInteractionPayloadSchema.refine(
  (payload) => !exceedsUtf8Bytes(JSON.stringify(payload), APPROVAL_MAX_BYTES),
  { message: `approval payload exceeds ${APPROVAL_MAX_BYTES} bytes` },
);

// the Mac mints the id, so reopening after a restart is the same row
export const openApprovalRequestSchema = z
  .object({
    id: dispatchIdSchema,
    payload: approvalPayloadSchema,
    threadId: threadIdSchema,
    turnId: turnIdSchema,
  })
  .strict();
export type OpenApprovalRequest = z.infer<typeof openApprovalRequestSchema>;

// open: waiting for an answer; answered: an answer is on its way to the Mac; closed: settled by
// that answer or on the Mac itself, or its turn ended
export const approvalStateSchema = z.enum(["open", "answered", "closed"]);
export type ApprovalState = z.infer<typeof approvalStateSchema>;

export const openApprovalResponseSchema = z.object({
  duplicate: z.boolean(),
  state: approvalStateSchema,
});
export type OpenApprovalResponse = z.infer<typeof openApprovalResponseSchema>;

export const closeApprovalRequestSchema = z.object({ id: dispatchIdSchema }).strict();
export type CloseApprovalRequest = z.infer<typeof closeApprovalRequestSchema>;

export const closeApprovalResponseSchema = z.object({ outcome: z.enum(["closed", "unknown"]) });
export type CloseApprovalResponse = z.infer<typeof closeApprovalResponseSchema>;

export const approvalRowSchema = z.object({
  createdAt: createdAtSchema,
  id: dispatchIdSchema,
  payload: approvalPendingInteractionPayloadSchema,
  state: approvalStateSchema.exclude(["closed"]),
  threadId: threadIdSchema,
  turnId: turnIdSchema,
});
export type ApprovalRow = z.infer<typeof approvalRowSchema>;

export const listApprovalsResponseSchema = z.object({
  approvals: z.array(approvalRowSchema).max(APPROVAL_MAX_OPEN),
});
export type ListApprovalsResponse = z.infer<typeof listApprovalsResponseSchema>;
