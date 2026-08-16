import { threadStatusSchema } from "@repo/domain/thread-status";
import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  noRequest,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./routes";
import { threadTimelineSchema, timelineDeltaSchema } from "./thread-timeline";

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
    archivedAt: z.number().nullable(),
    createdAt: z.number(),
    updatedAt: z.number(),
  })
  .strict();
export type Thread = z.infer<typeof threadSchema>;

export const pendingInteractionStatusSchema = z.enum([
  "pending",
  "resolving",
  "resolved",
  "interrupted",
]);
export type PendingInteractionStatus = z.infer<typeof pendingInteractionStatusSchema>;

export const pendingInteractionSchema = z
  .object({
    id: z.string().min(1),
    threadId: z.string().min(1),
    turnId: z.string().nullable(),
    requestKey: z.string().min(1),
    status: pendingInteractionStatusSchema,
    payload: z.unknown(),
    resolution: z.string().nullable(),
    createdAt: z.number(),
    resolvedAt: z.number().nullable(),
  })
  .strict();
export type PendingInteraction = z.infer<typeof pendingInteractionSchema>;

export const createThreadRequestSchema = z
  .object({
    title: z.string().min(1).optional(),
    originDocPath: z.string().min(1).optional(),
    originAnchor: z.string().min(1).optional(),
  })
  .strict()
  .superRefine((value, ctx) => {
    // Both-or-neither: a delegation binds to an anchored block, never half a
    // doc; the db CHECK is the storage-level twin of this refine.
    if ((value.originAnchor === undefined) !== (value.originDocPath === undefined)) {
      ctx.addIssue({
        code: "custom",
        message: "originDocPath and originAnchor must be provided together",
        path: [value.originAnchor === undefined ? "originAnchor" : "originDocPath"],
      });
    }
  });
export type CreateThreadRequest = z.infer<typeof createThreadRequestSchema>;

export interface ListThreadsResponse {
  threads: Thread[];
}

export const threadIdQuerySchema = z
  .object({
    threadId: z.string().min(1),
  })
  .strict();
export type ThreadIdQuery = z.infer<typeof threadIdQuerySchema>;

export interface GetThreadResponse {
  thread: Thread;
  pendingInteractions: PendingInteraction[];
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
