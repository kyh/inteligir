// the fill worker's wire: what the server thread posts and what the worker answers, parsed on both
// sides, since a worker speaking out of protocol is retired whole. The worker reads html it is
// handed and fetches nothing, so every resource a job needs travels in the job.

import { extractedPageSchema } from "@repo/page-reader/page-facts";
import { z } from "zod";

const extractJobSchema = z.strictObject({
  html: z.string(),
  id: z.number().int(),
  kind: z.literal("extract"),
  // "description": the page's description is the article (a video or a song), when it has one
  prefer: z.enum(["article", "description"]),
  url: z.string(),
});

const copyPlanJobSchema = z.strictObject({
  html: z.string(),
  id: z.number().int(),
  kind: z.literal("copy-plan"),
  url: z.string(),
});

const copyFileSchema = z.strictObject({
  bytes: z.number().int().min(0),
  dataUri: z.string(),
  kind: z.enum(["image", "font"]),
  url: z.string(),
});

const copyBuildJobSchema = z.strictObject({
  files: z.array(copyFileSchema),
  html: z.string(),
  id: z.number().int(),
  kind: z.literal("copy-build"),
  maxBytes: z.number().int().min(1),
  // the header's date, `YYYY-MM-DD`
  savedOn: z.string(),
  stylesheets: z.array(z.strictObject({ css: z.string(), url: z.string() })),
  url: z.string(),
});

export const fillJobSchema = z.discriminatedUnion("kind", [
  extractJobSchema,
  copyPlanJobSchema,
  copyBuildJobSchema,
]);
type FillJob = z.infer<typeof fillJobSchema>;
export type CopyFile = z.infer<typeof copyFileSchema>;

export const fillAnswerSchema = z.discriminatedUnion("kind", [
  extractedPageSchema.extend({ id: z.number().int(), kind: z.literal("extracted") }),
  z.strictObject({
    id: z.number().int(),
    // pictures (the best source of each), in document order
    images: z.array(z.string()),
    kind: z.literal("copy-plan"),
    // what inline styles and <style> blocks name, imports first
    styleImports: z.array(z.string()),
    styleRefs: z.array(z.strictObject({ kind: z.enum(["image", "font"]), url: z.string() })),
    stylesheets: z.array(z.string()),
  }),
  z.strictObject({ html: z.string(), id: z.number().int(), kind: z.literal("copy") }),
  z.strictObject({ id: z.number().int(), kind: z.literal("copy-too-big") }),
  z.strictObject({ id: z.number().int(), kind: z.literal("failed"), reason: z.string() }),
]);
export type FillAnswer = z.infer<typeof fillAnswerSchema>;

// Omit over each member of a union, so the members stay discriminated
type OmitEach<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

// a job and its answer without the id the transport pairs them by
export type FillJobInput = OmitEach<FillJob, "id">;
export type FillResult = OmitEach<FillAnswer, "id">;
