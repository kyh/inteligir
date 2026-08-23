// The anchored-comments wire contract (issue #583). The SIDECAR is the source
// of truth (`<note>.md.comments.json`, the inteligir-comments skill); these
// routes serve the HUMAN surface the editor
// drives. The division of labour is the skill's own: the EDITOR owns the body
// markers (it writes `%%i:id%%` pairs on add and strips them on delete), the
// routes own only the sidecar — so `remove` answers which root ids died and
// the editor strips their markers.
//
// The wire entry is a strict PROJECTION of the sidecar row: the file may hold
// fields older versions wrote that this version has never heard of, and those survive
// every rewrite — but they do not transit, because a strict wire is what lets
// the route tests catch an undeclared field. `anchored` is DERIVED per answer
// by re-reading the note's markers, never stored: a claim column would be
// wrong the first time the editor and the sidecar were written in either
// order.

import type { EmptyInput } from "@repo/typed-routes/endpoint";
import {
  defineRoute,
  jsonRequest,
  jsonResponse,
  queryRequest,
} from "@repo/typed-routes/route-descriptor";
import { z } from "zod";
import type { ApiErrorResponse } from "./errors";
import { vaultPathSchema } from "./vault";

export const COMMENTS_THREADS_MAX = 500;

export const commentSourceSchema = z.enum(["user", "agent", "external"]);

/** The marker grammar's own alphabet — every id could legally anchor. */
export const commentIdSchema = z.string().regex(/^[A-Za-z0-9_-]+$/);

export const commentEntryWireSchema = z
  .object({
    text: z.string(),
    createdAt: z.number(),
    updatedAt: z.number(),
    source: commentSourceSchema.optional(),
    parentId: z.string().optional(),
    imageUrls: z.array(z.string()).optional(),
    resolvedAt: z.number().optional(),
    resolvedBy: commentSourceSchema.optional(),
  })
  .strict();
export type CommentEntryWire = z.infer<typeof commentEntryWireSchema>;

export const commentThreadWireSchema = z
  .object({
    rootId: z.string(),
    root: commentEntryWireSchema,
    replies: z.array(z.object({ id: z.string(), entry: commentEntryWireSchema }).strict()),
    resolved: z.boolean(),
    /** The root's id appears in the note's body markers. */
    anchored: z.boolean(),
  })
  .strict();
export type CommentThreadWire = z.infer<typeof commentThreadWireSchema>;

export const commentsResponseSchema = z
  .object({
    path: z.string().min(1),
    threads: z.array(commentThreadWireSchema).max(COMMENTS_THREADS_MAX),
    /** Threads the sidecar holds; `threads.length < total` means cut. */
    total: z.number().int().min(0),
    /** Marker ids with no sidecar entry — one orphan direction; the other
     * (entry with no marker) is each thread's own `anchored: false`. */
    orphanMarkers: z.array(z.string()),
    /** Entries whose parent chain reaches no root — malformed, surfaced. */
    strayIds: z.array(z.string()),
  })
  .strict();
export type CommentsResponse = z.infer<typeof commentsResponseSchema>;

export const commentsListRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type CommentsListRequest = z.infer<typeof commentsListRequestSchema>;

export const commentsAddRequestSchema = z
  .object({
    path: vaultPathSchema,
    /** Client-minted (the editor writes the same id into the body markers
     * before or after this call — `anchored` derives, so order cannot lie). */
    id: commentIdSchema,
    text: z.string().min(1),
  })
  .strict();
export type CommentsAddRequest = z.infer<typeof commentsAddRequestSchema>;

export const commentsReplyRequestSchema = z
  .object({
    path: vaultPathSchema,
    id: commentIdSchema,
    parentId: commentIdSchema,
    text: z.string().min(1),
  })
  .strict();
export type CommentsReplyRequest = z.infer<typeof commentsReplyRequestSchema>;

export const commentsResolveRequestSchema = z
  .object({
    path: vaultPathSchema,
    id: commentIdSchema,
    resolved: z.boolean(),
  })
  .strict();
export type CommentsResolveRequest = z.infer<typeof commentsResolveRequestSchema>;

export const commentsRemoveRequestSchema = z
  .object({ path: vaultPathSchema, id: commentIdSchema })
  .strict();
export type CommentsRemoveRequest = z.infer<typeof commentsRemoveRequestSchema>;

export const commentsRemoveResponseSchema = commentsResponseSchema
  .extend({
    /** Every id the deletion removed — the editor strips these roots'
     * markers. */
    removedIds: z.array(z.string()),
  })
  .strict();
export type CommentsRemoveResponse = z.infer<typeof commentsRemoveResponseSchema>;

export const commentRoutes = {
  list: defineRoute({
    path: "/comments",
    method: "get",
    request: queryRequest<EmptyInput, CommentsListRequest>(commentsListRequestSchema),
    response: [
      jsonResponse<CommentsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  add: defineRoute({
    path: "/comments/add",
    method: "post",
    request: jsonRequest<EmptyInput, CommentsAddRequest>(commentsAddRequestSchema),
    response: [
      jsonResponse<CommentsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  reply: defineRoute({
    path: "/comments/reply",
    method: "post",
    request: jsonRequest<EmptyInput, CommentsReplyRequest>(commentsReplyRequestSchema),
    response: [
      jsonResponse<CommentsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  resolve: defineRoute({
    path: "/comments/resolve",
    method: "post",
    request: jsonRequest<EmptyInput, CommentsResolveRequest>(commentsResolveRequestSchema),
    response: [
      jsonResponse<CommentsResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
  remove: defineRoute({
    path: "/comments/remove",
    method: "post",
    request: jsonRequest<EmptyInput, CommentsRemoveRequest>(commentsRemoveRequestSchema),
    response: [
      jsonResponse<CommentsRemoveResponse>(),
      jsonResponse<ApiErrorResponse>({ status: 400 }),
      jsonResponse<ApiErrorResponse>({ status: 404 }),
      jsonResponse<ApiErrorResponse>({ status: 409 }),
    ],
  }),
};
