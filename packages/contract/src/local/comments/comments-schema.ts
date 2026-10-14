// the editor owns the body markers, these procedures own only the sidecar. the wire is a
// strict projection: sidecar fields this version never heard of survive rewrites but do not
// transit. `anchored` is derived per answer from the note's markers, never stored: a stored
// claim is wrong the first time the editor and the sidecar are written in either order.

import { z } from "zod";

import { commentIdSchema, commentSourceSchema } from "@repo/notes/comments/sidecar-schema";

import { vaultPathSchema } from "../vault/vault-schema";

export const COMMENTS_THREADS_MAX = 500;

export const commentEntryWireSchema = z.strictObject({
  // unix seconds as the sidecar stamps them, not epoch ms: createdAt, updatedAt and resolvedAt alike
  createdAt: z.number(),
  imageUrls: z.array(z.string()).optional(),
  parentId: z.string().optional(),
  resolvedAt: z.number().optional(),
  resolvedBy: commentSourceSchema.optional(),
  source: commentSourceSchema.optional(),
  text: z.string(),
  updatedAt: z.number(),
});
export type CommentEntryWire = z.infer<typeof commentEntryWireSchema>;

export const commentThreadWireSchema = z.strictObject({
  anchored: z.boolean(),
  replies: z.array(z.strictObject({ entry: commentEntryWireSchema, id: z.string() })),
  resolved: z.boolean(),
  root: commentEntryWireSchema,
  rootId: z.string(),
});
export type CommentThreadWire = z.infer<typeof commentThreadWireSchema>;

export const commentsResponseSchema = z.strictObject({
  // markers with no entry; the other orphan direction is each thread's own anchored: false
  orphanMarkers: z.array(z.string()),
  path: z.string().min(1),
  strayIds: z.array(z.string()),
  threads: z.array(commentThreadWireSchema).max(COMMENTS_THREADS_MAX),
  total: z.number().int().min(0),
});
export type CommentsResponse = z.infer<typeof commentsResponseSchema>;

export const commentsListRequestSchema = z.strictObject({ path: vaultPathSchema });
export type CommentsListRequest = z.infer<typeof commentsListRequestSchema>;

// the CLI says agent from an agent shell; a caller that says nothing is signed user by the server
const authorSource = commentSourceSchema.optional();

export const commentsAddRequestSchema = z.strictObject({
  // client-minted: the editor writes the same id into the markers before or after this call
  id: commentIdSchema,
  path: vaultPathSchema,
  source: authorSource,
  text: z.string().min(1),
});
export type CommentsAddRequest = z.infer<typeof commentsAddRequestSchema>;

export const commentsReplyRequestSchema = z.strictObject({
  id: commentIdSchema,
  parentId: commentIdSchema,
  path: vaultPathSchema,
  source: authorSource,
  text: z.string().min(1),
});
export type CommentsReplyRequest = z.infer<typeof commentsReplyRequestSchema>;

export const commentsResolveRequestSchema = z.strictObject({
  id: commentIdSchema,
  path: vaultPathSchema,
  resolved: z.boolean(),
  source: authorSource,
});
export type CommentsResolveRequest = z.infer<typeof commentsResolveRequestSchema>;

export const commentsRemoveRequestSchema = z.strictObject({
  id: commentIdSchema,
  path: vaultPathSchema,
});
export type CommentsRemoveRequest = z.infer<typeof commentsRemoveRequestSchema>;

export const commentsRemoveResponseSchema = commentsResponseSchema.extend({
  removedIds: z.array(z.string()),
});
export type CommentsRemoveResponse = z.infer<typeof commentsRemoveResponseSchema>;
