// the editor owns the body markers, these procedures own only the sidecar. the wire is a
// strict projection: sidecar fields this version never heard of survive rewrites but do not
// transit. `anchored` is derived per answer from the note's markers, never stored: a stored
// claim is wrong the first time the editor and the sidecar are written in either order.

import { z } from "zod";

import { commentIdSchema, commentSourceSchema } from "@repo/notes/comments/sidecar-schema";

import { vaultPathSchema } from "../vault/vault-schema";

export const COMMENTS_THREADS_MAX = 500;

export const commentEntryWireSchema = z
  .object({
    // unix seconds as the sidecar stamps them, not epoch ms: createdAt, updatedAt and resolvedAt alike
    createdAt: z.number(),
    imageUrls: z.array(z.string()).optional(),
    parentId: z.string().optional(),
    resolvedAt: z.number().optional(),
    resolvedBy: commentSourceSchema.optional(),
    source: commentSourceSchema.optional(),
    text: z.string(),
    updatedAt: z.number(),
  })
  .strict();
export type CommentEntryWire = z.infer<typeof commentEntryWireSchema>;

export const commentThreadWireSchema = z
  .object({
    anchored: z.boolean(),
    replies: z.array(z.object({ entry: commentEntryWireSchema, id: z.string() }).strict()),
    resolved: z.boolean(),
    root: commentEntryWireSchema,
    rootId: z.string(),
  })
  .strict();
export type CommentThreadWire = z.infer<typeof commentThreadWireSchema>;

export const commentsResponseSchema = z
  .object({
    // markers with no entry; the other orphan direction is each thread's own anchored: false
    orphanMarkers: z.array(z.string()),
    path: z.string().min(1),
    strayIds: z.array(z.string()),
    threads: z.array(commentThreadWireSchema).max(COMMENTS_THREADS_MAX),
    total: z.number().int().min(0),
  })
  .strict();
export type CommentsResponse = z.infer<typeof commentsResponseSchema>;

export const commentsListRequestSchema = z.object({ path: vaultPathSchema }).strict();
export type CommentsListRequest = z.infer<typeof commentsListRequestSchema>;

// the CLI says agent from an agent shell; a caller that says nothing is signed user by the server
const authorSource = commentSourceSchema.optional();

export const commentsAddRequestSchema = z
  .object({
    // client-minted: the editor writes the same id into the markers before or after this call
    id: commentIdSchema,
    path: vaultPathSchema,
    source: authorSource,
    text: z.string().min(1),
  })
  .strict();
export type CommentsAddRequest = z.infer<typeof commentsAddRequestSchema>;

export const commentsReplyRequestSchema = z
  .object({
    id: commentIdSchema,
    parentId: commentIdSchema,
    path: vaultPathSchema,
    source: authorSource,
    text: z.string().min(1),
  })
  .strict();
export type CommentsReplyRequest = z.infer<typeof commentsReplyRequestSchema>;

export const commentsResolveRequestSchema = z
  .object({
    id: commentIdSchema,
    path: vaultPathSchema,
    resolved: z.boolean(),
    source: authorSource,
  })
  .strict();
export type CommentsResolveRequest = z.infer<typeof commentsResolveRequestSchema>;

export const commentsRemoveRequestSchema = z
  .object({ id: commentIdSchema, path: vaultPathSchema })
  .strict();
export type CommentsRemoveRequest = z.infer<typeof commentsRemoveRequestSchema>;

export const commentsRemoveResponseSchema = commentsResponseSchema
  .extend({
    removedIds: z.array(z.string()),
  })
  .strict();
export type CommentsRemoveResponse = z.infer<typeof commentsRemoveResponseSchema>;
