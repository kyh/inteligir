// an import is a server job over a copy of the file: `plan` reads it and answers what it would
// do, `start` runs that plan, and `status` answers the latest job, which the page refetches on
// each import-changed frame.

import { z } from "zod";

import { IMPORT_SKIP_REASONS } from "@repo/notes/imports/raindrop";

export const IMPORT_FILE_MAX_BYTES = 64 * 1024 * 1024;
// a cover of about 50 KB plus the article: what one imported item's fill adds to the library
export const IMPORT_ITEM_ESTIMATE_BYTES = 64 * 1024;
export const IMPORT_LIST_MAX = 20;

export const importSourceSchema = z.enum(["raindrop"]);
export type ImportSource = z.infer<typeof importSourceSchema>;

export const importSkipReasonSchema = z.enum(IMPORT_SKIP_REASONS);
export type ImportSkipReason = z.infer<typeof importSkipReasonSchema>;

export const importsPlanRequestSchema = z.strictObject({
  file: z
    .instanceof(Blob)
    .refine((f) => f.size > 0, "the file is empty")
    .refine((f) => f.size <= IMPORT_FILE_MAX_BYTES, "the file is over 64 MB"),
  source: importSourceSchema,
});
export type ImportsPlanRequest = z.infer<typeof importsPlanRequestSchema>;

export const importsPlanResponseSchema = z.strictObject({
  // rows whose url key the library already holds
  alreadySaved: z.number().int().min(0),
  // tags that are not tag names, the first IMPORT_LIST_MAX
  droppedTags: z.array(z.string()).max(IMPORT_LIST_MAX),
  // rows folded into an earlier row with the same url key
  duplicates: z.number().int().min(0),
  // items × IMPORT_ITEM_ESTIMATE_BYTES: what the fills will add to the library, and so to the
  // online library
  estimatedBytes: z.number().int().min(0),
  folderCount: z.number().int().min(0),
  // library folders the import would use, the first 200
  folders: z.array(z.string()).max(200),
  highlights: z.number().int().min(0),
  // items the import would add, alreadySaved excluded
  items: z.number().int().min(0),
  planId: z.string().min(1),
  skipped: z
    .array(z.strictObject({ reason: importSkipReasonSchema, record: z.number().int().min(1) }))
    .max(IMPORT_LIST_MAX),
  skippedCount: z.number().int().min(0),
  tags: z.number().int().min(0),
});
export type ImportsPlanResponse = z.infer<typeof importsPlanResponseSchema>;

export const importJobSchema = z.strictObject({
  added: z.number().int().min(0),
  alreadySaved: z.number().int().min(0),
  // epoch ms
  finishedAt: z.number().int().nullable(),
  highlights: z.number().int().min(0),
  id: z.string().min(1),
  // a failed job's plain sentence
  message: z.string().nullable(),
  source: importSourceSchema,
  // epoch ms
  startedAt: z.number().int(),
  state: z.enum(["running", "done", "cancelled", "failed"]),
  total: z.number().int().min(0),
});
export type ImportJob = z.infer<typeof importJobSchema>;

export const importsStartRequestSchema = z.strictObject({ planId: z.string().min(1) });
export type ImportsStartRequest = z.infer<typeof importsStartRequestSchema>;

export const importsJobResponseSchema = z.strictObject({ job: importJobSchema });
export type ImportsJobResponse = z.infer<typeof importsJobResponseSchema>;

// the latest job, or null when this library never imported
export const importsStatusResponseSchema = z.strictObject({ job: importJobSchema.nullable() });
export type ImportsStatusResponse = z.infer<typeof importsStatusResponseSchema>;

export const importsCancelRequestSchema = z.strictObject({ id: z.string().min(1) });
export type ImportsCancelRequest = z.infer<typeof importsCancelRequestSchema>;
