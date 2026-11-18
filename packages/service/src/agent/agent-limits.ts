// What the built-in agent may spend in a UTC day, counted from the account's ledger, `agent_usage`:
// an account's two turns (owner decision: about fifty free turns a month, held first as a day's
// two) and its 50 cents of model calls, every account's $5 together, and what one turn may take,
// 20 model calls. A turn is booked as it starts and stopped there once the day's turns or dollars
// are gone, a call's dollars are charged as eve records them and stop the turn past a ceiling, and
// a send that would start a turn is refused first (`./eve-agent`, `./agent-sessions`). Two charges
// at once may each pass a ceiling the other crossed, so a day overshoots by a call at most.

import { AgentBudgetError, AgentUnavailableError } from "@repo/contract/rpc/v1-errors";
import { agentUsage } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { and, eq, gte, lt, sql } from "drizzle-orm";

const AGENT_DAY_TURNS = 2;

// a day's model spend in millionths of a dollar, an account's and every account's together (owner
// question 6, proposed)
const ACCOUNT_DAY_MICRO_USD = 500_000;
const TOTAL_DAY_MICRO_USD = 5_000_000;

// the most model calls one turn may take: it stops before the next, and the person asks the agent
// to go on, which a filing pass over many items needs and a loop does not
export const AGENT_TURN_STEPS = 20;

// the ledger keeps a month, for a month's spend to be read
const USAGE_KEPT_MS = 35 * 24 * 60 * 60 * 1000;

const DAY_MS = 24 * 60 * 60 * 1000;

const dayStartOf = (now: number): number => now - (now % DAY_MS);

// when the day `now` falls in ends, and its allowance fills again
export const nextDayAt = (now: number): number => dayStartOf(now) + DAY_MS;

// which limit stops a turn, as its row stamps it
export type TurnStop = "allowance" | "budget" | "steps";

// one spend where eve recorded it, which keys its row
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

const daySpend = async (
  executor: DbExecutor,
  accountId: string,
  now: number,
): Promise<DaySpend> => {
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
  };
};

const dollarsSpent = (spend: DaySpend): boolean =>
  spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD || spend.totalMicroUsd >= TOTAL_DAY_MICRO_USD;

// how many more turns today allows: none once the account's dollars are spent
export const turnsLeftToday = async (accountId: string, now: number): Promise<number> => {
  const spend = await daySpend(db, accountId, now);
  return spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD
    ? 0
    : Math.max(0, AGENT_DAY_TURNS - spend.turns);
};

// A send that would start a turn: refused while the account's day is spent, and while every
// account's dollars are, which no one of them can do anything about
export const refuseSendPastLimits = async (accountId: string, now: number): Promise<void> => {
  const spend = await daySpend(db, accountId, now);
  if (spend.totalMicroUsd >= TOTAL_DAY_MICRO_USD) {
    throw new AgentUnavailableError();
  }
  if (spend.turns >= AGENT_DAY_TURNS || spend.accountMicroUsd >= ACCOUNT_DAY_MICRO_USD) {
    throw new AgentBudgetError({ data: { resetsAt: nextDayAt(now) } });
  }
};

interface Spend {
  readonly kind: "turn" | "model" | "search";
  readonly costMicroUsd: number;
}

const keepSpend = async (
  executor: DbExecutor,
  at: UsageAt,
  spend: Spend,
  now: number,
): Promise<void> => {
  await executor
    .insert(agentUsage)
    .values({ ...at, ...spend, at: now })
    .onConflictDoNothing();
};

// The turn starting at `at`, booked on its day: past the day's turns, or with its dollars spent,
// it stops. One booking at a time an account, inside the caller's transaction, so two turns
// starting at once can't both take the day's last
export const bookTurn = async (
  tx: DbExecutor,
  at: UsageAt,
  now: number,
): Promise<TurnStop | null> => {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`agent-day:${at.accountId}`}))`);
  await keepSpend(tx, at, { costMicroUsd: 0, kind: "turn" }, now);
  const spend = await daySpend(tx, at.accountId, now);
  if (spend.turns > AGENT_DAY_TURNS) {
    return "allowance";
  }
  return dollarsSpent(spend) ? "budget" : null;
};

// a model call's tokens or a web search, charged on its day: past a ceiling, the turn stops
export const chargeSpend = async (
  at: UsageAt,
  spend: Spend & { readonly kind: "model" | "search" },
  now: number,
): Promise<TurnStop | null> => {
  await keepSpend(db, at, spend, now);
  return dollarsSpent(await daySpend(db, at.accountId, now)) ? "budget" : null;
};

// the ledger past a month gone, by the agent's cron
export const trimUsage = async (now: number): Promise<number> => {
  const trimmed = await db
    .delete(agentUsage)
    .where(lt(agentUsage.at, now - USAGE_KEPT_MS))
    .returning({ at: agentUsage.at });
  return trimmed.length;
};
