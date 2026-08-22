import { agentWriteModeSchema } from "@repo/domain/agent-write-mode";
import { pendingInteractionStatusSchema } from "@repo/domain/pending-interaction-status";
import { approvalPendingInteractionPayloadSchema } from "@repo/domain/pending-interactions";
import { threadStatusSchema } from "@repo/domain/thread-status";
import { viewContextSchema, type ViewContext } from "@repo/domain/view-context";
import { THREAD_ANCHOR_TOKEN_PATTERN } from "@repo/notes/markdown/thread-anchor";
import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
  optionalQueryRequest,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";
import { threadTimelineSchema, timelineDeltaSchema } from "./thread-timeline";
import { vaultPathSchema } from "./vault";

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

export interface ListThreadsResponse {
  threads: Thread[];
}

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
export interface DocThreadActivity {
  thread: Thread;
  openInteractionCount: number;
  queuedCount: number;
  pendingProposalCount: number;
}

export interface ListDocThreadsResponse {
  threads: DocThreadActivity[];
}

export const threadIdQuerySchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();
export type ThreadIdQuery = z.infer<typeof threadIdQuerySchema>;

export interface QueuedThreadMessage {
  id: string;
  text: string;
  createdAt: number;
}

export interface GetThreadResponse {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
  /** Unclaimed queued sends, drain order — the composer's pending bubbles. */
  queuedMessages: QueuedThreadMessage[];
}

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

export interface ListInteractionsResponse {
  interactions: PendingInteraction[];
}

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

export type SendMessageResponse =
  | { kind: "started"; turnId: string }
  | { kind: "steered"; turnId: string }
  | { kind: "queued"; queuedMessageId: string };

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
    afterSequence: z.coerce.number().int().nonnegative().optional(),
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

export interface AnswerInteractionResponse {
  interaction: PendingInteraction;
}

export const threadRoutes = {
  list: defineRoute({
    path: "/threads/list",
    method: "get",
    request: noRequest(),
    response: jsonResponse<ListThreadsResponse>(),
  }),
  get: defineRoute({
    path: "/threads/get",
    method: "get",
    request: queryRequest<EmptyInput, ThreadIdQuery>(threadIdQuerySchema),
    response: [
      jsonResponse<GetThreadResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  byDoc: defineRoute({
    path: "/threads/by-doc",
    method: "get",
    request: queryRequest<EmptyInput, DocThreadsQuery>(docThreadsQuerySchema),
    response: jsonResponse<ListDocThreadsResponse>(),
  }),
  create: defineRoute({
    path: "/threads/create",
    method: "post",
    request: jsonRequest<EmptyInput, CreateThreadRequest>(createThreadRequestSchema),
    response: jsonResponse<{ thread: Thread }>({ status: 201 }),
  }),
  archive: defineRoute({
    path: "/threads/archive",
    method: "post",
    request: jsonRequest<EmptyInput, ArchiveThreadRequest>(archiveThreadRequestSchema),
    response: [
      jsonResponse<{ thread: Thread }>(),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  send: defineRoute({
    path: "/threads/send",
    method: "post",
    request: jsonRequest<EmptyInput, SendMessageRequest>(sendMessageRequestSchema),
    response: [
      jsonResponse<SendMessageResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
      jsonResponse<ApiErrorResponse, 503>({ status: 503 }),
    ] as const,
  }),
  timeline: defineRoute({
    path: "/threads/timeline",
    method: "get",
    request: queryRequest<EmptyInput, TimelineQuery>(timelineQuerySchema),
    response: [
      jsonResponse<TimelineResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
    ] as const,
  }),
  listInteractions: defineRoute({
    path: "/threads/interaction/list",
    method: "get",
    request: optionalQueryRequest<EmptyInput, ListInteractionsQuery>(listInteractionsQuerySchema),
    response: jsonResponse<ListInteractionsResponse>(),
  }),
  answerInteraction: defineRoute({
    path: "/threads/interaction/answer",
    method: "post",
    request: jsonRequest<EmptyInput, AnswerInteractionRequest>(answerInteractionRequestSchema),
    response: [
      jsonResponse<AnswerInteractionResponse>(),
      // A resolution naming a decision the request never offered.
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ] as const,
  }),
};
