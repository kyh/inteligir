// What the first-run page and main say to each other before any server exists: the vault main
// proposes, a folder main picked and what it already is, and the choice the page hands back.
// Plain values parsed on both sides of the first-run bridge, like every other bridge state. The
// name grammar and the outside-sync sentences live here too, because the page and main both say
// them: the page before it asks, main when it refuses or confirms.

import { z } from "zod";
import { externalSyncName, externalSyncSchema } from "@repo/api/local/vault/vault-schema";
import type { ExternalSync } from "@repo/api/local/vault/vault-schema";

const folderPathSchema = z.string().min(1);

// a new vault's parent is a folder main handed out (the proposal, or a pick), so `finish` names
// nothing the page made up
export const firstRunStateSchema = z
  .object({
    newVault: z.object({ name: z.string().min(1), parent: folderPathSchema }).strict(),
  })
  .strict();
export type FirstRunState = z.infer<typeof firstRunStateSchema>;

// where the folder already syncs on its own, the app's hosted vault aside: a host, or a path on
// this Mac, which has none to name
const ownSyncSchema = z.discriminatedUnion("kind", [
  z.object({ host: z.string().min(1), kind: z.literal("host") }).strict(),
  z.object({ kind: z.literal("local") }).strict(),
]);
export type OwnSync = z.infer<typeof ownSyncSchema>;

const folderFactsSchema = z
  .object({
    externalSync: externalSyncSchema.nullable(),
    // the walk stops at a bound, so a capped count is a floor
    noteCount: z.object({ capped: z.boolean(), count: z.number().int().nonnegative() }).strict(),
    ownSync: ownSyncSchema.nullable(),
  })
  .strict();
export type FolderFacts = z.infer<typeof folderFactsSchema>;

const cancelledSchema = z.object({ kind: z.literal("cancelled") }).strict();

export const pickParentAnswerSchema = z.discriminatedUnion("kind", [
  cancelledSchema,
  z.object({ kind: z.literal("picked"), path: folderPathSchema }).strict(),
]);
export type PickParentAnswer = z.infer<typeof pickParentAnswerSchema>;

export const pickFolderAnswerSchema = z.discriminatedUnion("kind", [
  cancelledSchema,
  z
    .object({ facts: folderFactsSchema, kind: z.literal("picked"), path: folderPathSchema })
    .strict(),
]);
export type PickFolderAnswer = z.infer<typeof pickFolderAnswerSchema>;

export const firstRunChoiceSchema = z.discriminatedUnion("kind", [
  // the name as typed: main trims and judges it, as the page did before it asked
  z.object({ kind: z.literal("create"), name: z.string(), parent: folderPathSchema }).strict(),
  z.object({ kind: z.literal("open"), path: folderPathSchema }).strict(),
]);
export type FirstRunChoice = z.infer<typeof firstRunChoiceSchema>;

// a vault that opens replaces the page before any answer lands, so what the page sees is a refusal
// in main's words, or the boot's own failure
export const firstRunAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type FirstRunAnswer = z.infer<typeof firstRunAnswerSchema>;

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

export const ownSyncLine = (sync: OwnSync): string =>
  sync.kind === "host"
    ? `This folder already syncs with ${sync.host}, and keeps doing so.`
    : "This folder already syncs with another folder on this Mac, and keeps doing so.";
