// What the page and an export's thread (`./export-worker`) say to each other, parsed where each is
// heard, since a message crosses as a structured clone and carries no type.

import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { z } from "zod";

// the file the person chose in Chromium's save picker; jsdom and WebKit have no such class
const fileHandle = z.custom<FileSystemFileHandle>(
  (value) => "FileSystemFileHandle" in globalThis && value instanceof FileSystemFileHandle,
);

// where the zip goes: streamed to the file the person chose, or handed back whole for a download
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
  // the zip whole when it was asked for a download, null once it is in the file the person chose
  z.strictObject({
    counts: countsSchema,
    kind: z.literal("done"),
    zip: z.instanceof(Blob).nullable(),
  }),
  z.strictObject({ counts: countsSchema, kind: z.literal("failed"), message: z.string() }),
  z.strictObject({ end: z.enum(SESSION_ENDS), kind: z.literal("session-ended") }),
]);
export type ExportNews = z.infer<typeof exportNewsSchema>;
