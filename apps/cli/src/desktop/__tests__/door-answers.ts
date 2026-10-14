// The door's answers as the shell parses them, each held to the type its producer answers. The
// door's tests parse every answer with these, and tools/repo-guards/src/desktop-shell-wire.test.ts
// holds their keys to the serde types in apps/desktop/src-tauri/src/launch.rs and parses the
// fixtures the cargo tests read with them, so a field renamed on either side fails a gate.

import { folderFactsSchema } from "@repo/contract/local/vault/vault-folder";
import { externalSyncSchema } from "@repo/contract/local/vault/vault-schema";
import { z } from "zod";
import type { DoorAnswers, DoorVerb } from "../desktop-door";

export const targetAnswerSchema = z.strictObject({
  dataDir: z.string(),
  rootDataDir: z.string(),
  switchBlocked: z.string().nullable(),
  vaultDir: z.string(),
}) satisfies z.ZodType<DoorAnswers["select"]>;

export const planAnswerSchema = z.enum(["boot", "first-run"]) satisfies z.ZodType<
  DoorAnswers["launch"]["plan"]
>;

export const proposalAnswerSchema = z.strictObject({
  name: z.string(),
  parent: z.string(),
}) satisfies z.ZodType<DoorAnswers["launch"]["proposal"]>;

export const openingAnswerSchema = z.strictObject({
  selector: z.string().nullable(),
  vaultDir: z.string(),
}) satisfies z.ZodType<DoorAnswers["plan-open"]>;

export const warningAnswerSchema = z.strictObject({
  detail: z.string(),
  headline: z.string(),
}) satisfies z.ZodType<NonNullable<DoorAnswers["sync"]["warning"]>>;

export const doorAnswerSchemas = {
  facts: folderFactsSchema,
  handoff: z.strictObject({ url: z.string() }),
  launch: z.strictObject({
    env: z.record(z.string(), z.string()),
    notes: z.array(z.string()),
    plan: planAnswerSchema,
    proposal: proposalAnswerSchema,
    target: targetAnswerSchema,
  }),
  "plan-create": openingAnswerSchema,
  "plan-open": openingAnswerSchema,
  "plan-switch": openingAnswerSchema,
  select: targetAnswerSchema,
  sync: z.strictObject({
    externalSync: externalSyncSchema.nullable(),
    warning: warningAnswerSchema.nullable(),
  }),
} satisfies { [V in DoorVerb]: z.ZodType<DoorAnswers[V]> };
