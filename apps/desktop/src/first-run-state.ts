// What the first-run page and the shell say to each other before any server exists: the vault the
// shell proposes, a folder it picked and what that folder already is, and the choice the page hands
// back. Plain values the page parses off the shell's answers, like every other bridge state. What a
// folder is and the sentences said about it are `@repo/contract/local/vault/vault-folder`'s, which the
// CLI's desktop entry answers from.

import { z } from "zod";
import { folderFactsSchema } from "@repo/contract/local/vault/vault-folder";
import { externalSyncSchema } from "@repo/contract/local/vault/vault-schema";

const folderPathSchema = z.string().min(1);

// a new vault's parent is a folder the shell handed out (the proposal, or a pick), so `finish`
// names nothing the page made up
export const firstRunStateSchema = z
  .object({
    newVault: z.object({ name: z.string().min(1), parent: folderPathSchema }).strict(),
  })
  .strict();
export type FirstRunState = z.infer<typeof firstRunStateSchema>;

const cancelledSchema = z.object({ kind: z.literal("cancelled") }).strict();

export const pickParentAnswerSchema = z.discriminatedUnion("kind", [
  cancelledSchema,
  z
    .object({
      // where the vault would land, so a service syncing it is said before the vault is made
      externalSync: externalSyncSchema.nullable(),
      kind: z.literal("picked"),
      path: folderPathSchema,
    })
    .strict(),
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
  // the name as typed: the CLI trims and judges it, as the page did before it asked
  z.object({ kind: z.literal("create"), name: z.string(), parent: folderPathSchema }).strict(),
  z.object({ kind: z.literal("open"), path: folderPathSchema }).strict(),
]);
export type FirstRunChoice = z.infer<typeof firstRunChoiceSchema>;

// a vault that opens replaces the page before any answer lands, so what the page sees is a refusal
// in the shell's words, or the boot's own failure
export const firstRunAnswerSchema = z.discriminatedUnion("ok", [
  z.object({ ok: z.literal(true) }).strict(),
  z.object({ ok: z.literal(false), reason: z.string().min(1) }).strict(),
]);
export type FirstRunAnswer = z.infer<typeof firstRunAnswerSchema>;
