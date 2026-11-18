// The person's standing with the built-in agent: whether they keep it on, and their filing rules,
// which it follows over its own taste in every turn (apps/web/agent/instructions/filing-rules.ts).
// An account with no row has it on and keeps no rules. Both are written as the library's writes
// are, under its lock and answered once under an op id (`../library/library-store`), and neither is
// an item's, so neither joins a change set.

import { agentPreference } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { eq } from "drizzle-orm";
import { z } from "zod";

import type { WriteScope } from "../library/library-store";

export const switchedSchema = z.object({ enabled: z.boolean() });
export const rulesSchema = z.object({ rules: z.string() });

const preferenceOf = async (accountId: string, executor: DbExecutor) => {
  const [row] = await executor
    .select({ enabled: agentPreference.enabled, filingRules: agentPreference.filingRules })
    .from(agentPreference)
    .where(eq(agentPreference.accountId, accountId));
  return row ?? null;
};

export const agentEnabled = async (
  accountId: string,
  executor: DbExecutor = db,
): Promise<boolean> => {
  const preference = await preferenceOf(accountId, executor);
  return preference?.enabled ?? true;
};

// the rules as the person left them, blank or not, null before they wrote any
export const readFilingRules = async (accountId: string): Promise<string | null> => {
  const preference = await preferenceOf(accountId, db);
  return preference?.filingRules ?? null;
};

// the rules a turn is held to: none while the person wrote none, or left the page blank
export const filingRulesFor = async (accountId: string): Promise<string | null> => {
  const rules = await readFilingRules(accountId);
  return rules === null || rules.trim() === "" ? null : rules;
};

export const writeAgentEnabled = async (
  scope: WriteScope,
  enabled: boolean,
): Promise<z.input<typeof switchedSchema>> => {
  await scope.tx
    .insert(agentPreference)
    .values({ accountId: scope.accountId, enabled })
    .onConflictDoUpdate({ set: { enabled }, target: agentPreference.accountId });
  return { enabled };
};

export const writeFilingRules = async (
  scope: WriteScope,
  rules: string,
): Promise<z.input<typeof rulesSchema>> => {
  await scope.tx
    .insert(agentPreference)
    .values({ accountId: scope.accountId, enabled: true, filingRules: rules })
    .onConflictDoUpdate({ set: { filingRules: rules }, target: agentPreference.accountId });
  return { rules };
};
