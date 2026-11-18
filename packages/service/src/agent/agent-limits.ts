import { AgentBudgetError, AgentUnavailableError } from "@repo/contract/rpc/v1-errors";
import { agentUsage } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const AGENT_DAY_TURNS = 2;

const ACCOUNT_DAY_MICRO_USD = 500_000;
const TOTAL_DAY_MICRO_USD = 5_000_000;

export const AGENT_TURN_STEPS = 20;

const USAGE_KEPT_MS = 35 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const dayStartOf = (now: number) => now - (now % DAY_MS);

export const nextDayAt = (now: number) => dayStartOf(now) + DAY_MS;

export type TurnStop = "allowance" | "budget" | "steps";

export interface UsageAt {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionNumber: number;
  readonly line: number;
  readonly index: number;
}

interface DaySpend {
  readonly turns: number;
  readonly accountMicroUsd: number;
  readonly totalMicroUsd: number;
}

const costSum = () => sql`coalesce(sum(${agentUsage.costMicroUsd}), 0)`.mapWith(Number);

const daySpend = async (executor: DbExecutor, accountId: string, now: number) => {
  const today = gte(agentUsage.at, dayStartOf(now));

  const [account] = await executor
    .select({
      cost: costSum(),
      turns: sql`count(*) filter (where ${agentUsage.kind} = 'turn')`.mapWith(Number),
    })
    .from(agentUsage)
    .where(and(eq(agentUsage.accountId, accountId), today));

  const [total] = await executor.select({ cost: costSum() }).from(agentUsage).where(today);

  return {
    accountMicroUsd: account?.cost ?? 0,
    totalMicroUsd: total?.cost ?? 0,
    turns: account?.turns ?? 0,
  } satisfies DaySpend;
};

const dollarsSpent = (spend: DaySpend) =>
  spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD || spend.totalMicroUsd >= TOTAL_DAY_MICRO_USD;

export const turnsLeftToday = async (accountId: string, now: number) => {
  const spend = await daySpend(db, accountId, now);

  return spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD
    ? 0
    : Math.max(0, AGENT_DAY_TURNS - spend.turns);
};

export const refuseSendPastLimits = async (accountId: string, now: number) => {
  const spend = await daySpend(db, accountId, now);

  if (spend.totalMicroUsd >= TOTAL_DAY_MICRO_USD) {
    throw new AgentUnavailableError({ data: { resetsAt: nextDayAt(now) } });
  }

  if (spend.turns >= AGENT_DAY_TURNS || spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD) {
    throw new AgentBudgetError({ data: { resetsAt: nextDayAt(now) } });
  }
};

interface Spend {
  readonly kind: "turn" | "model" | "search";
  readonly costMicroUsd: number;
}

const keepSpend = async (executor: DbExecutor, at: UsageAt, spend: Spend, now: number) => {
  await executor
    .insert(agentUsage)
    .values({ ...at, ...spend, at: now })
    .onConflictDoNothing();
};

export const bookTurn = async (tx: DbExecutor, at: UsageAt, now: number) => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-day:${at.accountId}`}))`);
  await keepSpend(tx, at, { costMicroUsd: 0, kind: "turn" }, now);
  const spend = await daySpend(tx, at.accountId, now);

  if (spend.turns > AGENT_DAY_TURNS) {
    return "allowance" as const;
  }

  return (dollarsSpent(spend) ? "budget" : null) satisfies TurnStop | null;
};

export const chargeSpend = async (
  at: UsageAt,
  spend: Spend & { readonly kind: "model" | "search" },
  now: number,
) => {
  await keepSpend(db, at, spend, now);

  return (
    dollarsSpent(await daySpend(db, at.accountId, now)) ? "budget" : null
  ) satisfies TurnStop | null;
};

export const trimUsage = async (now: number) => {
  const trimmed = await db
    .delete(agentUsage)
    .where(lt(agentUsage.at, now - USAGE_KEPT_MS))
    .returning({ at: agentUsage.at });

  return trimmed.length;
};
