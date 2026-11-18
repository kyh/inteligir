// What the built-in agent may run for one account: about fifty free turns a month, held first as a
// UTC day's two (owner decision), counted from the turns' own rows.

import { agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import { and, count, eq, gte } from "drizzle-orm";

const AGENT_DAY_TURNS = 2;

const DAY_MS = 24 * 60 * 60 * 1000;

const dayStartOf = (now: number): number => now - (now % DAY_MS);

// when the day `now` falls in ends, and its allowance fills again
export const nextDayAt = (now: number): number => dayStartOf(now) + DAY_MS;

// how many more turns today allows
export const turnsLeftToday = async (accountId: string, now: number): Promise<number> => {
  const [row] = await db
    .select({ turns: count() })
    .from(agentTurn)
    .where(and(eq(agentTurn.accountId, accountId), gte(agentTurn.startedAt, dayStartOf(now))));
  return Math.max(0, AGENT_DAY_TURNS - (row?.turns ?? 0));
};
