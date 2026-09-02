import { pendingInteractionStatusSchema } from "@repo/domain/pending-interaction-status";
import { approvalPendingInteractionPayloadSchema } from "@repo/domain/pending-interactions";
import { threadStatusSchema } from "@repo/domain/thread-status";
import { viewContextSchema, type ViewContext } from "@repo/domain/view-context";
import { z } from "zod";
import { threadTimelineSchema, timelineDeltaSchema } from "../thread-timeline";
import { vaultPathSchema } from "../vault/vault-schema";

export const threadSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().nullable(),
    status: threadStatusSchema,
    activeTurnId: z.string().nullable(),
    originDocPath: z.string().nullable(),
    providerId: z.string().nullable(),
    archivedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Thread = z.infer<typeof threadSchema>;

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().nullable(),
    requestKey: z.string().min(1),
    status: pendingInteractionStatusSchema,
    // null when the stored json does not parse: the card stays answerable (deny), and one bad
    // payload must not fail the thread load.
    payload: approvalPendingInteractionPayloadSchema.nullable(),
    resolution: z.string().nullable(),
    createdAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .strict();
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

const MAX_THREAD_TITLE_LENGTH = 200;

export const createThreadRequestSchema = z
  .object({
    title: z.string().min(1).max(MAX_THREAD_TITLE_LENGTH).optional(),
    // a stored path nothing downstream re-validates.
    originDocPath: vaultPathSchema.optional(),
  })
  .strict();
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const threadResponseSchema = z.object({ thread: threadSchema }).strict();
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export const listThreadsResponseSchema = z.object({ threads: z.array(threadSchema) }).strict();
export type ListThreadsResponse = z.infer<typeof listThreadsResponseSchema>;

export const threadIdQuerySchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();
export type ThreadIdQuery = z.infer<typeof threadIdQuerySchema>;

export const queuedThreadMessageSchema = z
  .object({
    id: z.string(),
    text: z.string(),
    createdAt: z.number(),
  })
  .strict();
export type QueuedThreadMessage = z.infer<typeof queuedThreadMessageSchema>;

export const getThreadResponseSchema = z
  .object({
    thread: threadSchema,
    pendingInteractions: z.array(pendingInteractionSchema),
    queuedMessages: z.array(queuedThreadMessageSchema),
  })
  .strict();
export type GetThreadResponse = z.infer<typeof getThreadResponseSchema>;

export const listInteractionsQuerySchema = z
  .object({
    threadId: z.string().min(1).optional(),
  })
  .strict();
export type ListInteractionsQuery = z.infer<typeof listInteractionsQuerySchema>;

export const listInteractionsResponseSchema = z
  .object({ interactions: z.array(pendingInteractionSchema) })
  .strict();
export type ListInteractionsResponse = z.infer<typeof listInteractionsResponseSchema>;

export const archiveThreadRequestSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();
export type ArchiveThreadRequest = z.infer<typeof archiveThreadRequestSchema>;

// the resource reaches a prompt with no further validation.
const wireViewContextSchema = viewContextSchema.transform((value, ctx): ViewContext => {
  const resource = vaultPathSchema.safeParse(value.resource);
  if (!resource.success) {
    ctx.addIssue({
      code: "custom",
      message: "viewContext.resource is not a vault path",
      path: ["resource"],
    });
    return z.NEVER;
  }
  return { ...value, resource: resource.data };
});

export const sendMessageRequestSchema = z
  .object({
    threadId: z.string().min(1),
    text: z.string().min(1),
    // the turn the client believes is running; when it no longer names the open turn the send
    // answers 409 rather than starting one.
    expectedTurnId: z.string().min(1).optional(),
    viewContext: wireViewContextSchema.optional(),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), turnId: z.string() }).strict(),
  z.object({ kind: z.literal("queued"), queuedMessageId: z.string() }).strict(),
]);
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const timelineQuerySchema = z
  .object({
    threadId: z.string().min(1),
    // the client's last maxSequence; the server answers a delta from it, or the full timeline
    // when it cannot reconstruct that base.
    afterSequence: z.number().int().nonnegative().optional(),
  })
  .strict();
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const timelineResponseSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("full"),
      timeline: threadTimelineSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("delta"),
      delta: timelineDeltaSchema,
    })
    .strict(),
]);
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

export const answerInteractionRequestSchema = z
  .object({
    threadId: z.string().min(1),
    interactionId: z.string().min(1),
    // stays a string: the row stores and replays it verbatim; `parseApprovalResolution` is the
    // one parser.
    resolution: z.string().min(1),
  })
  .strict();
export type AnswerInteractionRequest = z.infer<typeof answerInteractionRequestSchema>;

export const answerInteractionResponseSchema = z
  .object({ interaction: pendingInteractionSchema })
  .strict();
export type AnswerInteractionResponse = z.infer<typeof answerInteractionResponseSchema>;
