// What the built-in agent may run for one account (owner decision: about fifty free turns a month,
// held first as a day's share). The numbers are the deployment's own data, `AGENT_ALLOWANCE` in
// apps/web/cloudflare.config.ts, never code. A send is counted as a turn when it is let in, and
// refused once the day's turns are spent. What the turns cost is held by the gateway's spend limit
// for each account alone (`./anthropic-client`), whose refusal ends the turn (`./thread-loop`).

import { count, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { agentQueue, agentUsage } from "@repo/db/cell/schema";
import type { CellDb } from "../library/cell-db";

const DAY_MS = 24 * 60 * 60 * 1000;

const allowanceSchema = z.object({
  // the turns that may run at once across the account's threads
  concurrentTurns: z.number().int().positive(),
  // the turns a UTC day allows
  dayTurns: z.number().int().positive(),
});

export type Allowance = z.infer<typeof allowanceSchema>;

export const allowanceOf = (env: Env): Allowance => allowanceSchema.parse(env.AGENT_ALLOWANCE);

// ---- days ----

// the UTC day `now` falls in, as the ledger keys it, and when the next one starts
export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const nextDayAt = (now: number): number => now - (now % DAY_MS) + DAY_MS;

// ---- the ledger ----

// how many more turns today allows, the waiting sends counted as taken
export const turnsLeft = (db: CellDb, allowance: Allowance, now: number): number => {
  const spent =
    db
      .select({ turns: agentUsage.turns })
      .from(agentUsage)
      .where(eq(agentUsage.day, dayOf(now)))
      .get()?.turns ?? 0;
  const queued = db.select({ count: count() }).from(agentQueue).get()?.count ?? 0;
  return Math.max(0, allowance.dayTurns - spent - queued);
};

// a turn begun is booked on its day, so the allowance counts it from its start, and one Claude could
// not be reached for is given back on the day it was booked
export const bookTurn = (db: CellDb, day: string, turns: 1 | -1): void => {
  db.insert(agentUsage)
    .values({ day, turns: Math.max(0, turns) })
    .onConflictDoUpdate({
      set: { turns: sql`max(0, ${agentUsage.turns} + ${turns})` },
      target: agentUsage.day,
    })
    .run();
};
