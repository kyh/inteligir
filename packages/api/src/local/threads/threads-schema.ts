import { pendingInteractionStatusSchema } from "@repo/domain/pending-interaction-status";
import { approvalPendingInteractionPayloadSchema } from "@repo/domain/pending-interactions";
import { threadStatusSchema } from "@repo/domain/thread-status";
import { viewContextSchema } from "@repo/domain/view-context";
import type { ViewContext } from "@repo/domain/view-context";
import { z } from "zod";
import { threadTimelineSchema, timelineDeltaSchema } from "../thread-timeline";
import { vaultPathSchema } from "../vault/vault-schema";

export const threadSchema = z
  .object({
    activeTurnId: z.string().nullable(),
    archivedAt: z.number().nullable(),
    createdAt: z.number(),
    id: z.string().min(1),
    originDocPath: z.string().nullable(),
    providerId: z.string().nullable(),
    status: threadStatusSchema,
    title: z.string().nullable(),
    updatedAt: z.number(),
  })
  .strict();
export type Thread = z.infer<typeof threadSchema>;

export const pendingInteractionSchema = z
  .object({
    createdAt: z.number(),
    id: z.string().min(1),
    // null when the stored json does not parse: the card stays answerable (deny), and one bad
    // payload must not fail the thread load.
    payload: approvalPendingInteractionPayloadSchema.nullable(),
    requestKey: z.string().min(1),
    resolution: z.string().nullable(),
    resolvedAt: z.number().nullable(),
    status: pendingInteractionStatusSchema,
    threadId: z.string().min(1),
    turnId: z.string().nullable(),
  })
  .strict();
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

const MAX_THREAD_TITLE_LENGTH = 200;

export const createThreadRequestSchema = z
  .object({
    // a stored path nothing downstream re-validates.
    originDocPath: vaultPathSchema.optional(),
    title: z.string().min(1).max(MAX_THREAD_TITLE_LENGTH).optional(),
  })
  .strict();
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const threadResponseSchema = z.object({ thread: threadSchema }).strict();
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export const THREADS_LIST_DEFAULT_LIMIT = 50;
export const THREADS_LIST_MAX_LIMIT = 200;

// where a page left off: the last row's segment, updatedAt and id, the key the listing sorts by.
export interface ThreadListCursor {
  archived: boolean;
  updatedAt: number;
  id: string;
}

const CURSOR_PATTERN = /^(?<segment>[la])\.(?<updatedAt>\d{1,16})\.(?<id>.+)$/u;

// a string, so a shell can hand back what `inteligir action list` printed.
export const encodeThreadListCursor = (cursor: ThreadListCursor): string =>
  `${cursor.archived ? "a" : "l"}.${String(cursor.updatedAt)}.${cursor.id}`;

const threadListCursorSchema = z.string().transform((value, ctx): ThreadListCursor => {
  const groups = CURSOR_PATTERN.exec(value)?.groups;
  const updatedAt = Number(groups?.updatedAt);
  if (
    groups?.segment === undefined ||
    groups.id === undefined ||
    !Number.isSafeInteger(updatedAt)
  ) {
    ctx.addIssue({ code: "custom", message: "cursor is not one a thread listing answered" });
    return z.NEVER;
  }
  return { archived: groups.segment === "a", id: groups.id, updatedAt };
});

export const listThreadsQuerySchema = z
  .object({
    // the previous page's `nextCursor`.
    cursor: threadListCursorSchema.optional(),
    includeArchived: z.boolean().optional(),
    limit: z.number().int().min(1).max(THREADS_LIST_MAX_LIMIT).optional(),
    originDocPath: vaultPathSchema.optional(),
    // only threads whose turn is in flight; true or absent, one spelling of "any status".
    running: z.literal(true).optional(),
  })
  .strict();
export type ListThreadsQuery = z.input<typeof listThreadsQuerySchema>;
export type ParsedListThreadsQuery = z.output<typeof listThreadsQuerySchema>;

// live threads come first, newest first within each segment; no `total`, since a count would
// cost the scan paging avoids.
export const listThreadsResponseSchema = z
  .object({
    // null once the listing is exhausted.
    nextCursor: z.string().nullable(),
    threads: z.array(threadSchema).max(THREADS_LIST_MAX_LIMIT),
  })
  .strict();
export type ListThreadsResponse = z.infer<typeof listThreadsResponseSchema>;

export const threadIdQuerySchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();
export type ThreadIdQuery = z.infer<typeof threadIdQuerySchema>;

export const queuedThreadMessageSchema = z
  .object({
    createdAt: z.number(),
    id: z.string(),
    text: z.string(),
  })
  .strict();
export type QueuedThreadMessage = z.infer<typeof queuedThreadMessageSchema>;

export const getThreadResponseSchema = z
  .object({
    pendingInteractions: z.array(pendingInteractionSchema),
    queuedMessages: z.array(queuedThreadMessageSchema),
    thread: threadSchema,
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

export const interruptThreadRequestSchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();

// requested: the agent was asked to stop and the thread reads stopping until its turn ends;
// stopped: the turn never reached the agent, so the stop settled at once; not-running: nothing to stop.
export const threadStopSchema = z.enum(["requested", "stopped", "not-running"]);
export type ThreadStop = z.infer<typeof threadStopSchema>;

export const interruptThreadResponseSchema = z
  .object({ stop: threadStopSchema, thread: threadSchema })
  .strict();
export type InterruptThreadResponse = z.infer<typeof interruptThreadResponseSchema>;

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

const MAX_CONTEXT_PATHS = 16;

// absent, never empty, when nothing is attached: one spelling of "none".
const contextPathsSchema = z
  .array(vaultPathSchema)
  .min(1)
  .max(MAX_CONTEXT_PATHS)
  .refine((paths) => new Set(paths).size === paths.length, {
    message: "contextPaths names a note twice",
  });

export const sendMessageRequestSchema = z
  .object({
    // the notes the user attached; the server names them to the agent in a block of their own,
    // so `text` stays exactly what was typed.
    contextPaths: contextPathsSchema.optional(),
    // the turn the client believes is running; when it no longer names the open turn the send
    // answers 409 rather than starting one.
    expectedTurnId: z.string().min(1).optional(),
    text: z.string().min(1),
    threadId: z.string().min(1),
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
    // the client's last maxSequence; the server answers a delta from it, or the full timeline
    // when it cannot reconstruct that base.
    afterSequence: z.number().int().nonnegative().optional(),
    threadId: z.string().min(1),
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
      delta: timelineDeltaSchema,
      kind: z.literal("delta"),
    })
    .strict(),
]);
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

export const answerInteractionRequestSchema = z
  .object({
    interactionId: z.string().min(1),
    // stays a string: the row stores and replays it verbatim; `parseApprovalResolution` is the
    // one parser.
    resolution: z.string().min(1),
    threadId: z.string().min(1),
  })
  .strict();
export type AnswerInteractionRequest = z.infer<typeof answerInteractionRequestSchema>;

export const answerInteractionResponseSchema = z
  .object({ interaction: pendingInteractionSchema })
  .strict();
export type AnswerInteractionResponse = z.infer<typeof answerInteractionResponseSchema>;
