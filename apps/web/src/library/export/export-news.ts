import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { z } from "zod";

const fileHandle = z.custom<FileSystemFileHandle>(
  (value) => "FileSystemFileHandle" in globalThis && value instanceof FileSystemFileHandle,
);

export const exportAskSchema = z.discriminatedUnion("kind", [
  z.strictObject({ handle: fileHandle, kind: z.literal("file") }),
  z.strictObject({ kind: z.literal("download") }),
]);

export type ExportAsk = z.infer<typeof exportAskSchema>;

const count = z.number().int().nonnegative();

const countsSchema = z.strictObject({
  filesMissing: count,
  items: count,
  propertiesLeftOut: count,
});

export type ExportCounts = z.infer<typeof countsSchema>;

const SESSION_ENDS = ["signed-out", "gone", "outdated"] as const satisfies readonly SessionEnd[];

export const exportNewsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("listing") }),
  z.strictObject({ kind: z.literal("writing"), total: count, written: count }),
  z.strictObject({
    counts: countsSchema,
    kind: z.literal("done"),
    zip: z.instanceof(Blob).nullable(),
  }),
  z.strictObject({ counts: countsSchema, kind: z.literal("failed"), message: z.string() }),
  z.strictObject({ end: z.enum(SESSION_ENDS), kind: z.literal("session-ended") }),
]);

export type ExportNews = z.infer<typeof exportNewsSchema>;
