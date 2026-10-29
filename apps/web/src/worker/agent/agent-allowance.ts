// What the built-in agent may spend for one account, which the cell checks before every turn: a
// UTC day's turns and list cost, and the most one turn may cost (owner decision: about fifty free
// turns a month, enforced first as a daily cap). The numbers are the deployment's own data,
// `AGENT_ALLOWANCE` in cloudflare.config.ts, never code. Each session is created with a budget and
// has it set again before each turn, so the platform itself stops a turn at its share
// (platform.claude.com/docs/en/managed-agents/budgets): what the session already consumed, plus the
// smaller of what the day has left and one turn's ceiling, and always at least a cent more, since
// the consumed figure is rounded to the cent and a cap at or below it is refused.

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

const DAY_MS = 24 * 60 * 60 * 1000;

const allowanceSchema = z.object({
  // the turns a day allows, the list cost in cents it allows, and one turn's ceiling in cents
  dayCents: z.number().int().positive(),
  dayTurns: z.number().int().positive(),
  turnCents: z.number().int().positive(),
});

export type Allowance = z.infer<typeof allowanceSchema>;

export const allowanceOf = (env: Env): Allowance => allowanceSchema.parse(env.AGENT_ALLOWANCE);

// the UTC day `now` falls in, as the ledger keys it, and when the next one starts
const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const nextDayAt = (now: number): number => now - (now % DAY_MS) + DAY_MS;

// the session's cap for its next turn, in cents: above what it consumed, by at most the ceiling
export const turnCap = (spend: {
  readonly consumedCents: number;
  readonly remainingCents: number;
  readonly ceilingCents: number;
}): number => spend.consumedCents + Math.max(1, Math.min(spend.remainingCents, spend.ceilingCents));

// a cap as a budget takes it: an integer string of cents, never a decimal
export const budgetOf = (cents: number) => ({
  max_list_cost: { amount: String(Math.trunc(cents)), currency: "USD" as const },
  type: "limit" as const,
});

const spentSchema = z.object({ cost_cents: z.number(), turns: z.number() });
const countSchema = z.object({ count: z.number() });

// what today took so far: its turns, the sends waiting for one, and its list cost
const spentToday = (sql: SqlStatements, now: number) => {
  const [row] = sql.all("SELECT turns, cost_cents FROM agent_usage WHERE day = ?", [dayOf(now)]);
  const spent = row === undefined ? { cost_cents: 0, turns: 0 } : spentSchema.parse(row);
  const [queued] = sql.all("SELECT count(*) AS count FROM agent_queue", []);
  return {
    costCents: spent.cost_cents,
    queued: countSchema.parse(queued).count,
    turns: spent.turns,
  };
};

// how many more turns today allows, the waiting sends counted as taken; none once its cost is spent
export const turnsLeft = (sql: SqlStatements, allowance: Allowance, now: number): number => {
  const spent = spentToday(sql, now);
  return spent.costCents >= allowance.dayCents
    ? 0
    : Math.max(0, allowance.dayTurns - spent.turns - spent.queued);
};

// what the day has left of its list cost, for the next turn's cap
export const centsLeft = (sql: SqlStatements, allowance: Allowance, now: number): number =>
  Math.max(0, allowance.dayCents - spentToday(sql, now).costCents);

// a turn begun is booked on its day, so the allowance counts it from its start
export const bookTurn = (sql: SqlStatements, now: number, turns: 1 | -1): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, input_tokens, cached_tokens, output_tokens, cost_cents)
     VALUES (?, ?, 0, 0, 0, 0)
     ON CONFLICT (day) DO UPDATE SET turns = max(0, turns + excluded.turns)`,
    [dayOf(now), turns],
  );
};

export interface UsageDelta {
  readonly costCents: number;
  readonly input: number;
  readonly cached: number;
  readonly output: number;
}

// what a session spent since the ledger last booked it, on the day it was reported
export const bookUsage = (sql: SqlStatements, now: number, delta: UsageDelta): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, input_tokens, cached_tokens, output_tokens, cost_cents)
     VALUES (?, 0, ?, ?, ?, ?)
     ON CONFLICT (day) DO UPDATE SET input_tokens = input_tokens + excluded.input_tokens,
       cached_tokens = cached_tokens + excluded.cached_tokens,
       output_tokens = output_tokens + excluded.output_tokens,
       cost_cents = cost_cents + excluded.cost_cents`,
    [dayOf(now), delta.input, delta.cached, delta.output, delta.costCents],
  );
};
