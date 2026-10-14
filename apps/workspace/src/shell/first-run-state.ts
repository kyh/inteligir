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
export const firstRunStateSchema = z.strictObject({
  newVault: z.strictObject({ name: z.string().min(1), parent: folderPathSchema }),
});
export type FirstRunState = z.infer<typeof firstRunStateSchema>;

const cancelledSchema = z.strictObject({ kind: z.literal("cancelled") });

export const pickParentAnswerSchema = z.discriminatedUnion("kind", [
  cancelledSchema,
  z.strictObject({
    // where the vault would land, so a service syncing it is said before the vault is made
    externalSync: externalSyncSchema.nullable(),
    kind: z.literal("picked"),
    path: folderPathSchema,
  }),
]);
export type PickParentAnswer = z.infer<typeof pickParentAnswerSchema>;

export const pickFolderAnswerSchema = z.discriminatedUnion("kind", [
  cancelledSchema,
  z.strictObject({ facts: folderFactsSchema, kind: z.literal("picked"), path: folderPathSchema }),
]);

export const firstRunChoiceSchema = z.discriminatedUnion("kind", [
  // the name as typed: the CLI trims and judges it, as the page did before it asked
  z.strictObject({ kind: z.literal("create"), name: z.string(), parent: folderPathSchema }),
  z.strictObject({ kind: z.literal("open"), path: folderPathSchema }),
]);
export type FirstRunChoice = z.infer<typeof firstRunChoiceSchema>;
