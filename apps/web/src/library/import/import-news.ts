import type { SessionEnd } from "@repo/contract/rpc/call-outcome";
import { z } from "zod";

import { IMPORT_SOURCES } from "./import-sources";

export const importAskSchema = z.strictObject({
  file: z.instanceof(Blob),
  source: z.enum(IMPORT_SOURCES),
});

export type ImportAsk = z.infer<typeof importAskSchema>;

const count = z.number().int().nonnegative();

const countsSchema = z.strictObject({ added: count, alreadySaved: count, unreadable: count });

export type ImportCounts = z.infer<typeof countsSchema>;

const SESSION_ENDS = ["signed-out", "gone", "outdated"] as const satisfies readonly SessionEnd[];

export const importNewsSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("reading") }),
  z.strictObject({ counts: countsSchema, kind: z.literal("landing"), total: count }),
  z.strictObject({ counts: countsSchema, kind: z.literal("done") }),
  z.strictObject({ counts: countsSchema, kind: z.literal("failed"), message: z.string() }),
  z.strictObject({ end: z.enum(SESSION_ENDS), kind: z.literal("session-ended") }),
]);

export type ImportNews = z.infer<typeof importNewsSchema>;
