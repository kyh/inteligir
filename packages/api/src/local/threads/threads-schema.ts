// Threads: the agent conversation surface — the thread row itself, the sends
// that drive a turn, the timeline projection a client renders, and the pending
// interactions a turn blocks on.

import { agentWriteModeSchema } from "@repo/domain/agent-write-mode";
import { pendingInteractionStatusSchema } from "@repo/domain/pending-interaction-status";
import { approvalPendingInteractionPayloadSchema } from "@repo/domain/pending-interactions";
import { threadStatusSchema } from "@repo/domain/thread-status";
import { viewContextSchema, type ViewContext } from "@repo/domain/view-context";
import { THREAD_ANCHOR_TOKEN_PATTERN } from "@repo/notes/markdown/thread-anchor";
import { z } from "zod";
import { threadTimelineSchema, timelineDeltaSchema } from "../thread-timeline";
import { vaultPathSchema } from "../vault/vault-schema";

export const threadSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().nullable(),
    status: threadStatusSchema,
    /** The turn the status describes — the client's `expectedTurnId` source. */
    activeTurnId: z.string().nullable(),
    /** Set together for a doc-bound delegation; both null for a plain chat. */
    originDocPath: z.string().nullable(),
    originAnchor: z.string().nullable(),
    /** The harness this thread runs on, once one ever dispatched (or was
     *  chosen at create); null adopts the default at next dispatch. */
    providerId: z.string().nullable(),
    /** Where this thread's turns land: the vault, or a reviewable proposal. */
    writeMode: agentWriteModeSchema,
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
    /** The approval grammar, parsed server-side out of the row's JSON column.
     *  null when those bytes do not match it: the card is still answerable —
     *  deny is the one decision every request accepts — and a whole thread
     *  must not fail to load because one payload is unreadable. */
    payload: approvalPendingInteractionPayloadSchema.nullable(),
    resolution: z.string().nullable(),
    createdAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .strict();
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

const MAX_THREAD_TITLE_LENGTH = 200;

/** The anchor token grammar, stated once in @repo/notes and validated here so
 *  a stored anchor always matches what the marker in the file can spell. */
const originAnchorSchema = z.string().regex(new RegExp(THREAD_ANCHOR_TOKEN_PATTERN, "u"), {
  message: "originAnchor must be anc_ followed by 12 lowercase hex digits",
});

export const createThreadRequestSchema = z
  .object({
    title: z.string().min(1).max(MAX_THREAD_TITLE_LENGTH).optional(),
    /** A thread's origin is a stored path nothing else re-validates, so a bad
     *  one would sit in the database forever, unmatched by every by-doc query. */
    originDocPath: vaultPathSchema.optional(),
    originAnchor: originAnchorSchema.optional(),
    /** The harness this thread runs on ("claude" | "codex" today); omitted
     *  adopts the server's default at first dispatch. */
    providerId: z.string().min(1).optional(),
    /** Omitted means `direct` — v1's behaviour, so a caller that has never
     *  heard of review mode keeps the semantics it was written against. */
    writeMode: agentWriteModeSchema.optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // An anchor names a marker inside its doc, so it cannot exist without one;
    // a doc ALONE is a marker-less attachment (an action composed over the
    // note, #587). The db CHECK is the storage-level twin of this refine.
    if (value.originAnchor !== undefined && value.originDocPath === undefined) {
      ctx.addIssue({
        code: "custom",
        message: "originAnchor requires originDocPath",
        path: [value.originAnchor === undefined ? "originAnchor" : "originDocPath"],
      });
    }
  });
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

/** The single-thread answer of a create or an archive. */
export const threadResponseSchema = z.object({ thread: threadSchema }).strict();
export type ThreadResponse = z.infer<typeof threadResponseSchema>;

export const listThreadsResponseSchema = z.object({ threads: z.array(threadSchema) }).strict();
export type ListThreadsResponse = z.infer<typeof listThreadsResponseSchema>;

export const docThreadsQuerySchema = z
  .object({
    docPath: z.string().min(1),
  })
  .strict();
export type DocThreadsQuery = z.infer<typeof docThreadsQuerySchema>;

/**
 * A doc-bound thread with the activity counts a status chip needs and a
 * `Thread` alone cannot answer: an open approval, a queued send and a pending
 * proposal are rows in their own tables, not thread columns.
 */
export const docThreadActivitySchema = z
  .object({
    thread: threadSchema,
    openInteractionCount: z.number(),
    queuedCount: z.number(),
    pendingProposalCount: z.number(),
  })
  .strict();
export type DocThreadActivity = z.infer<typeof docThreadActivitySchema>;

export const listDocThreadsResponseSchema = z
  .object({ threads: z.array(docThreadActivitySchema) })
  .strict();
export type ListDocThreadsResponse = z.infer<typeof listDocThreadsResponseSchema>;

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
    /** Unclaimed queued sends, drain order — the composer's pending bubbles. */
    queuedMessages: z.array(queuedThreadMessageSchema),
  })
  .strict();
export type GetThreadResponse = z.infer<typeof getThreadResponseSchema>;

/**
 * `threadId` narrows to one thread; omitted, the answer is every OPEN
 * interaction this host holds. One request either way — a client must never
 * have to walk the thread list to find what is waiting on it.
 */
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

export const sendMessageModeSchema = z.enum(["steer-if-active", "queue-if-active"]);
export type SendMessageMode = z.infer<typeof sendMessageModeSchema>;

/**
 * The domain shape with its `resource` held to the vault path grammar, exactly
 * as `createThreadRequestSchema` holds `originDocPath`: a path nothing
 * downstream re-validates would otherwise reach a prompt unchecked.
 */
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

/**
 * `expectedTurnId` is the staleness guard: the turn the client believes is
 * running. When it no longer names the open turn — it settled, or another
 * client started a new one — the send is refused with 409 instead of landing
 * on a turn the user never saw.
 */
export const sendMessageRequestSchema = z
  .object({
    threadId: z.string().min(1),
    text: z.string().min(1),
    mode: sendMessageModeSchema,
    expectedTurnId: z.string().min(1).optional(),
    /** What the sender was looking at. Optional because most senders are
     *  looking at nothing this host can name — the CLI, the palette, a chat
     *  with no note open. */
    viewContext: wireViewContextSchema.optional(),
  })
  .strict();
export type SendMessageRequest = z.infer<typeof sendMessageRequestSchema>;

export const sendMessageResponseSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("started"), turnId: z.string() }).strict(),
  z.object({ kind: z.literal("steered"), turnId: z.string() }).strict(),
  z.object({ kind: z.literal("queued"), queuedMessageId: z.string() }).strict(),
]);
export type SendMessageResponse = z.infer<typeof sendMessageResponseSchema>;

/**
 * `afterSequence` is the client's own `maxSequence` from its last fetch;
 * omitted, the server answers the full timeline. Sent, the server answers a
 * delta based on exactly that prefix — or the full timeline when it cannot
 * reconstruct the named base — and the client applies it with
 * `applyTimelineDelta`, refetching in full if that returns null.
 */
export const timelineQuerySchema = z
  .object({
    threadId: z.string().min(1),
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
    /**
     * The approval-resolution grammar, owned by
     * `@repo/domain/pending-interactions` (`parseApprovalResolution` is the one
     * parser, shared by the route's 400 gate and the runtime): a bare decision
     * verb — `"allow_once"`, `"allow_for_session"`, `"deny"` — or the JSON of
     * `approvalPendingInteractionResolutionSchema`. Anything else answers 400;
     * it stays a string here because the row stores and replays it verbatim.
     */
    resolution: z.string().min(1),
  })
  .strict();
export type AnswerInteractionRequest = z.infer<typeof answerInteractionRequestSchema>;

export const answerInteractionResponseSchema = z
  .object({ interaction: pendingInteractionSchema })
  .strict();
export type AnswerInteractionResponse = z.infer<typeof answerInteractionResponseSchema>;
