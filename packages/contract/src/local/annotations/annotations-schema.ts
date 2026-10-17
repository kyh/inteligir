// the editor owns the body markers, these procedures own only the store. the wire is a
// strict projection: store fields this version never heard of survive rewrites but do not
// transit. `anchored` is derived per answer from the note's markers, never stored: a stored
// claim is wrong the first time the editor and the store are written in either order.

import { z } from "zod";

import { annotationIdSchema, annotationSourceSchema } from "@repo/notes/annotations/store-schema";

import { vaultPathSchema } from "../vault/vault-schema";

// a response lists at most this many, in its order; `total` counts all
export const ANNOTATIONS_MAX = 500;

export const annotationEntryWireSchema = z.strictObject({
  // unix seconds as the store stamps them, not epoch ms: createdAt and updatedAt alike
  createdAt: z.number(),
  parentId: z.string().optional(),
  // roots only: the passage's plain text when the highlight was made
  quote: z.string().optional(),
  source: annotationSourceSchema.optional(),
  // "" is a bare highlight
  text: z.string(),
  updatedAt: z.number(),
});
export type AnnotationEntryWire = z.infer<typeof annotationEntryWireSchema>;

export const annotationWireSchema = z.strictObject({
  anchored: z.boolean(),
  id: z.string(),
  replies: z.array(z.strictObject({ entry: annotationEntryWireSchema, id: z.string() })),
  root: annotationEntryWireSchema,
});
export type AnnotationWire = z.infer<typeof annotationWireSchema>;

export const annotationsResponseSchema = z.strictObject({
  // anchored in document order, then the unanchored by createdAt
  annotations: z.array(annotationWireSchema).max(ANNOTATIONS_MAX),
  // markers with no entry; the other orphan direction is each annotation's own anchored: false
  orphanMarkers: z.array(z.string()),
  path: z.string().min(1),
  strayIds: z.array(z.string()),
  total: z.number().int().min(0),
});
export type AnnotationsResponse = z.infer<typeof annotationsResponseSchema>;

export const annotationsListRequestSchema = z.strictObject({ path: vaultPathSchema });
export type AnnotationsListRequest = z.infer<typeof annotationsListRequestSchema>;

// the CLI says agent from an agent shell; a caller that says nothing is signed user by the server
const authorSource = annotationSourceSchema.optional();

const NOTE_MAX = 20_000;

export const annotationsAddRequestSchema = z.strictObject({
  // client-minted: the editor writes the same id into the markers before or after this call
  id: annotationIdSchema,
  path: vaultPathSchema,
  // the passage's plain text; a selection with no text offers no highlight
  quote: z.string().trim().min(1),
  source: authorSource,
  // "" is a bare highlight; its note comes later through `edit`
  text: z.string().max(NOTE_MAX).default(""),
});
export type AnnotationsAddRequest = z.infer<typeof annotationsAddRequestSchema>;

export const annotationsEditRequestSchema = z.strictObject({
  id: annotationIdSchema,
  path: vaultPathSchema,
  source: authorSource,
  // "" takes a root's note away and leaves the highlight
  text: z.string().max(NOTE_MAX),
});
export type AnnotationsEditRequest = z.infer<typeof annotationsEditRequestSchema>;

export const annotationsReplyRequestSchema = z.strictObject({
  id: annotationIdSchema,
  parentId: annotationIdSchema,
  path: vaultPathSchema,
  source: authorSource,
  text: z.string().min(1),
});
export type AnnotationsReplyRequest = z.infer<typeof annotationsReplyRequestSchema>;

export const annotationsRemoveRequestSchema = z.strictObject({
  id: annotationIdSchema,
  path: vaultPathSchema,
});
export type AnnotationsRemoveRequest = z.infer<typeof annotationsRemoveRequestSchema>;

export const annotationsRemoveResponseSchema = annotationsResponseSchema.extend({
  removedIds: z.array(z.string()),
});
export type AnnotationsRemoveResponse = z.infer<typeof annotationsRemoveResponseSchema>;
