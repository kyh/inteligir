import { pendingInteractionStatusSchema } from "@repo/domain/pending-interaction-status";
import {
  approvalPendingInteractionPayloadSchema,
  pendingInteractionApprovalDecisionSchema,
} from "@repo/domain/pending-interactions";
import { threadStatusSchema } from "@repo/domain/thread-status";
import { MAX_THREAD_TITLE_LENGTH } from "@repo/domain/thread-title";
import { viewContextSchema } from "@repo/domain/view-context";
import type { ViewContext } from "@repo/domain/view-context";
import { z } from "zod";
import { threadTimelineSchema, timelineDeltaSchema } from "../thread-timeline";
import { contentHashSchema, vaultPathSchema } from "../vault/vault-schema";

export const threadSchema = z.strictObject({
  activeTurnId: z.string().nullable(),
  archivedAt: z.number().nullable(),
  createdAt: z.number(),
  id: z.string().min(1),
  originDocPath: z.string().nullable(),
  providerId: z.string().nullable(),
  // the running turn is another device's, so only that device can stop it.
  runsElsewhere: z.boolean(),
  status: threadStatusSchema,
  title: z.string().nullable(),
  updatedAt: z.number(),
});
export type Thread = z.infer<typeof threadSchema>;

export const pendingInteractionSchema = z.strictObject({
  createdAt: z.number(),
  decision: pendingInteractionApprovalDecisionSchema.nullable(),
  id: z.string().min(1),
  // null when the stored json does not parse: the card stays answerable (deny), and one bad
  // payload must not fail the thread load.
  payload: approvalPendingInteractionPayloadSchema.nullable(),
  requestKey: z.string().min(1),
  resolvedAt: z.number().nullable(),
  status: pendingInteractionStatusSchema,
  threadId: z.string().min(1),
  turnId: z.string().nullable(),
});
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

export const createThreadRequestSchema = z.strictObject({
  // a stored path nothing downstream re-validates.
  originDocPath: vaultPathSchema.optional(),
  title: z.string().min(1).max(MAX_THREAD_TITLE_LENGTH).optional(),
});
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export const threadResponseSchema = z.strictObject({ thread: threadSchema });
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

export const listThreadsQuerySchema = z.strictObject({
  // the previous page's `nextCursor`.
  cursor: threadListCursorSchema.optional(),
  includeArchived: z.boolean().optional(),
  limit: z.number().int().min(1).max(THREADS_LIST_MAX_LIMIT).optional(),
  originDocPath: vaultPathSchema.optional(),
  // text the title or the stored origin path holds, ascii case folded; a page of the whole
  // listing cannot answer it.
  query: z.string().trim().min(1).max(200).optional(),
  // only threads whose turn is in flight; true or absent, one spelling of "any status".
  running: z.literal(true).optional(),
});
export type ListThreadsQuery = z.input<typeof listThreadsQuerySchema>;
export type ParsedListThreadsQuery = z.output<typeof listThreadsQuerySchema>;

// live threads come first, newest first within each segment; no `total`, since a count would
// cost the scan paging avoids.
export const listThreadsResponseSchema = z.strictObject({
  // null once the listing is exhausted.
  nextCursor: z.string().nullable(),
  threads: z.array(threadSchema).max(THREADS_LIST_MAX_LIMIT),
});
export type ListThreadsResponse = z.infer<typeof listThreadsResponseSchema>;

export const threadIdQuerySchema = z.strictObject({
  threadId: z.string().min(1),
});
export type ThreadIdQuery = z.infer<typeof threadIdQuerySchema>;

export const queuedThreadMessageSchema = z.strictObject({
  createdAt: z.number(),
  id: z.string(),
  text: z.string(),
});
export type QueuedThreadMessage = z.infer<typeof queuedThreadMessageSchema>;

export const getThreadResponseSchema = z.strictObject({
  pendingInteractions: z.array(pendingInteractionSchema),
  queuedMessages: z.array(queuedThreadMessageSchema),
  thread: threadSchema,
});
export type GetThreadResponse = z.infer<typeof getThreadResponseSchema>;

export const listInteractionsQuerySchema = z.strictObject({
  threadId: z.string().min(1).optional(),
});
export type ListInteractionsQuery = z.infer<typeof listInteractionsQuerySchema>;

export const listInteractionsResponseSchema = z.strictObject({
  interactions: z.array(pendingInteractionSchema),
});
export type ListInteractionsResponse = z.infer<typeof listInteractionsResponseSchema>;

export const archiveThreadRequestSchema = z.strictObject({
  threadId: z.string().min(1),
});
export type ArchiveThreadRequest = z.infer<typeof archiveThreadRequestSchema>;

export const interruptThreadRequestSchema = z.strictObject({
  threadId: z.string().min(1),
});

// requested: the agent was asked to stop and the thread reads stopping until its turn ends;
// stopped: the turn never reached the agent, so the stop settled at once; not-running: nothing to stop.
export const threadStopSchema = z.enum(["requested", "stopped", "not-running"]);
export type ThreadStop = z.infer<typeof threadStopSchema>;

export const interruptThreadResponseSchema = z.strictObject({
  stop: threadStopSchema,
  thread: threadSchema,
});
export type InterruptThreadResponse = z.infer<typeof interruptThreadResponseSchema>;

// the resource and the revision reach a prompt with no further validation. the stored grammar
// stays looser so a row written before either rule still parses.
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
  if (!contentHashSchema.safeParse(value.revision).success) {
    ctx.addIssue({
      code: "custom",
      message: "viewContext.revision is not a content hash",
      path: ["revision"],
    });
    return z.NEVER;
  }
  return { ...value, resource: resource.data };
});

export const MAX_CONTEXT_PATHS = 16;

// absent, never empty, when nothing is attached: one spelling of "none".
const contextPathsSchema = z
  .array(vaultPathSchema)
  .min(1)
  .max(MAX_CONTEXT_PATHS)
  .refine((paths) => new Set(paths).size === paths.length, {
    message: "contextPaths names a note twice",
  });

export const sendMessageRequestSchema = z.strictObject({
  // the notes the user attached; the server names them to the agent in a block of their own,
  // so `text` stays exactly what was typed.
  contextPaths: contextPathsSchema.optional(),
  // the turn the client believes is running; when it no longer names the open turn the send
  // answers 409 rather than starting one.
  expectedTurnId: z.string().min(1).optional(),
  text: z.string().min(1),
  threadId: z.string().min(1),
  viewContext: wireViewContextSchema.optional(),
});
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("started"), turnId: z.string() }),
  z.strictObject({ kind: z.literal("queued"), queuedMessageId: z.string() }),
]);
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

export const timelineQuerySchema = z.strictObject({
  // the client's last maxSequence; the server answers a delta from it, or the full timeline
  // when it cannot reconstruct that base.
  afterSequence: z.number().int().nonnegative().optional(),
  threadId: z.string().min(1),
});
export type TimelineQuery = z.infer<typeof timelineQuerySchema>;

export const timelineResponseSchema = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("full"),
    timeline: threadTimelineSchema,
  }),
  z.strictObject({
    delta: timelineDeltaSchema,
    kind: z.literal("delta"),
  }),
]);
export type TimelineResponse = z.infer<typeof timelineResponseSchema>;

// undone: a later commit reverted the turn's changes.
export const turnChangeStateSchema = z.enum(["applied", "undone"]);
export type TurnChangeState = z.infer<typeof turnChangeStateSchema>;

export const turnChangesSchema = z.strictObject({
  // every path the turn's commit added, edited or deleted; a move is the path it left and the
  // path it made.
  paths: z.array(z.string().min(1)),
  state: turnChangeStateSchema,
  turnId: z.string().min(1),
});
export type TurnChanges = z.infer<typeof turnChangesSchema>;

// oldest first, only the turns that committed a change.
export const turnChangesResponseSchema = z.strictObject({ turns: z.array(turnChangesSchema) });
export type TurnChangesResponse = z.infer<typeof turnChangesResponseSchema>;

export const undoTurnRequestSchema = z.strictObject({
  threadId: z.string().min(1),
  turnId: z.string().min(1),
});
export type UndoTurnRequest = z.infer<typeof undoTurnRequestSchema>;

// why a path the turn changed was left as it is: edited, deleted or put back since the turn;
// claimed by a turn still running; or not text the undo can merge (too large, or not UTF-8).
export const undoKeptReasonSchema = z.enum([
  "edited-since",
  "deleted-since",
  "recreated-since",
  "busy",
  "unreadable",
]);
export type UndoKeptReason = z.infer<typeof undoKeptReasonSchema>;

export const undoKeptPathSchema = z.strictObject({
  path: z.string().min(1),
  reason: undoKeptReasonSchema,
});
export type UndoKeptPath = z.infer<typeof undoKeptPathSchema>;

// a path already back as it was before the turn is in neither list.
export const undoTurnResponseSchema = z.strictObject({
  kept: z.array(undoKeptPathSchema),
  reverted: z.array(z.string().min(1)),
});
export type UndoTurnResponse = z.infer<typeof undoTurnResponseSchema>;

export const answerInteractionRequestSchema = z.strictObject({
  // the shape is the wire's to refuse; whether this request offers the decision is the
  // route's, from the stored payload (`unanswerableReason`).
  decision: pendingInteractionApprovalDecisionSchema,
  interactionId: z.string().min(1),
  threadId: z.string().min(1),
});
export type AnswerInteractionRequest = z.infer<typeof answerInteractionRequestSchema>;

export const answerInteractionResponseSchema = z.strictObject({
  interaction: pendingInteractionSchema,
});
export type AnswerInteractionResponse = z.infer<typeof answerInteractionResponseSchema>;
