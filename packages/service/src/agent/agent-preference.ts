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

export const agentEnabled = async (accountId: string, executor: DbExecutor = db) => {
  const preference = await preferenceOf(accountId, executor);

  return preference?.enabled ?? true;
};

export const readFilingRules = async (accountId: string) => {
  const preference = await preferenceOf(accountId, db);

  return preference?.filingRules ?? null;
};

export const filingRulesFor = async (accountId: string) => {
  const rules = await readFilingRules(accountId);

  return rules === null || rules.trim() === "" ? null : rules;
};

export const writeAgentEnabled = async (scope: WriteScope, enabled: boolean) => {
  await scope.tx
    .insert(agentPreference)
    .values({ accountId: scope.accountId, enabled })
    .onConflictDoUpdate({ set: { enabled }, target: agentPreference.accountId });

  return { enabled } satisfies z.input<typeof switchedSchema>;
};

export const writeFilingRules = async (scope: WriteScope, rules: string) => {
  await scope.tx
    .insert(agentPreference)
    .values({ accountId: scope.accountId, enabled: true, filingRules: rules })
    .onConflictDoUpdate({ set: { filingRules: rules }, target: agentPreference.accountId });

  return { rules } satisfies z.input<typeof rulesSchema>;
};
