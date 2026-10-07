// What a folder is before it is a vault, and what is said about it: the CLI's desktop entry
// answers the facts for the shell, the first-run page shows them, and both say the sentences: the
// page before it asks, the shell when it confirms or refuses. One spelling for both.

import { z } from "zod";
import { externalSyncName, externalSyncSchema } from "./vault-schema";
import type { ExternalSync } from "./vault-schema";

// where the folder already syncs on its own, the app's hosted vault aside: a host, or a path on
// this Mac, which has none to name
export const ownSyncSchema = z.discriminatedUnion("kind", [
  z.object({ host: z.string().min(1), kind: z.literal("host") }).strict(),
  z.object({ kind: z.literal("local") }).strict(),
]);
export type OwnSync = z.infer<typeof ownSyncSchema>;

export const folderFactsSchema = z
  .object({
    externalSync: externalSyncSchema.nullable(),
    // the walk stops at a bound, so a capped count is a floor
    noteCount: z.object({ capped: z.boolean(), count: z.number().int().nonnegative() }).strict(),
    ownSync: ownSyncSchema.nullable(),
  })
  .strict();
export type FolderFacts = z.infer<typeof folderFactsSchema>;

// one folder's name, made beside the parent: a `/` or `:` would name another folder (Finder shows a
// `/` as `:`), and a leading dot hides the vault from Finder
export const vaultNameProblem = (name: string): string | null => {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Give the vault a name.";
  }
  if (/[/:]/u.test(trimmed)) {
    return "A name can't contain / or :.";
  }
  if (trimmed.startsWith(".")) {
    return "A name can't start with a dot.";
  }
  return null;
};

export interface OutsideSyncWarning {
  headline: string;
  detail: string;
}

// two sync engines over one folder fight, so the service keeps it and the app stays off it
export const outsideSyncWarning = (sync: ExternalSync): OutsideSyncWarning => ({
  detail: "Inteligir won't sync these notes, and your phone won't see them.",
  headline: `${externalSyncName(sync)} keeps syncing this folder.`,
});
