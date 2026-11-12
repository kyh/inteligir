// What the built-in agent may run for one account (owner decision: about fifty free turns a month,
// held first as a day's share). The numbers are the deployment's own data, `AGENT_ALLOWANCE` in
// apps/web/cloudflare.config.ts, never code. A send is counted as a turn when it is let in, and
// refused once the day's turns are spent. What the turns cost is held by the gateway's spend limit
// for each account alone (`./anthropic-client`), whose refusal ends the turn (`./thread-loop`).

import type { SqlStatements } from "../library/library-sql";
import { z } from "zod";

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

const countSchema = z.object({ count: z.number() });

// how many more turns today allows, the waiting sends counted as taken
export const turnsLeft = (sql: SqlStatements, allowance: Allowance, now: number): number => {
  const [spent] = sql.all("SELECT turns AS count FROM agent_usage WHERE day = ?", [dayOf(now)]);
  const [queued] = sql.all("SELECT count(*) AS count FROM agent_queue", []);
  const taken = spent === undefined ? 0 : countSchema.parse(spent).count;
  return Math.max(0, allowance.dayTurns - taken - countSchema.parse(queued).count);
};

// a turn begun is booked on its day, so the allowance counts it from its start, and one Claude could
// not be reached for is given back on the day it was booked
export const bookTurn = (sql: SqlStatements, day: string, turns: 1 | -1): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns) VALUES (?, max(0, ?))
     ON CONFLICT (day) DO UPDATE SET turns = max(0, turns + ?)`,
    [day, turns, turns],
  );
};
