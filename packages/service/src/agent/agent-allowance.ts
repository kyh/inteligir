// What the built-in agent may spend for one account, and what each reply cost (owner decision: about
// fifty free turns a month, held first as a day's share). The numbers are the deployment's own
// data, `AGENT_ALLOWANCE` and `AGENT_PRICES` in apps/web/cloudflare.config.ts, never code. A send
// is counted as a turn when it is let in, and refused once the day's turns or its list cost are
// spent; each reply is booked at its exact usage at list price once it lands, on the day its turn
// started. What one turn may cost is bounded by its steps and each step's output cap
// (`./library-agent`), and what a stream cut short cost, which no usage reports, by the gateway's
// per-account spend limit. Money is integer micro-cents throughout: a price of two decimals in
// dollars a million tokens is a whole number of micro-cents a token, so nothing rounds.

import type { SqlStatements } from "../library/library-sql";
import { z } from "zod";

const DAY_MS = 24 * 60 * 60 * 1000;

// micro-cents a cent
/** @internal */
export const UCENTS_PER_CENT = 1_000_000;

const allowanceSchema = z.object({
  // the turns that may run at once across the account's threads
  concurrentTurns: z.number().int().positive(),
  // the list cost in cents and the turns a UTC day allows
  dayCents: z.number().int().positive(),
  dayTurns: z.number().int().positive(),
});

export type Allowance = z.infer<typeof allowanceSchema>;

export const allowanceOf = (env: Env): Allowance => allowanceSchema.parse(env.AGENT_ALLOWANCE);

// dollars a million tokens, at most two decimals, so a token is a whole number of micro-cents
const priceSchema = z
  .number()
  .nonnegative()
  .refine((price) => Math.abs(price * 100 - Math.round(price * 100)) < 1e-9, {
    error: "a price has at most two decimals",
  });

const modelPricesSchema = z.strictObject({
  cacheRead: priceSchema,
  cacheWrite1h: priceSchema,
  cacheWrite5m: priceSchema,
  input: priceSchema,
  output: priceSchema,
});

/** @internal */
export const agentPricesSchema = z.record(z.string(), modelPricesSchema);

// one model's prices in micro-cents a token
interface TokenPrices {
  readonly input: number;
  readonly output: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
}

export type PriceTable = ReadonlyMap<string, TokenPrices>;

const ucents = (dollarsPerMillion: number): number => Math.round(dollarsPerMillion * 100);

/** @internal */
export const priceTableOf = (prices: z.infer<typeof agentPricesSchema>): PriceTable =>
  new Map(
    Object.entries(prices).map(([model, row]) => [
      model,
      {
        cacheRead: ucents(row.cacheRead),
        cacheWrite1h: ucents(row.cacheWrite1h),
        cacheWrite5m: ucents(row.cacheWrite5m),
        input: ucents(row.input),
        output: ucents(row.output),
      },
    ]),
  );

export const pricesOf = (env: Env): PriceTable =>
  priceTableOf(agentPricesSchema.parse(env.AGENT_PRICES));

// a model's row, or the dearest row for one the table does not price, which is logged
/** @internal */
export const pricesFor = (table: PriceTable, model: string): TokenPrices => {
  const row = table.get(model);
  if (row !== undefined) {
    return row;
  }
  console.error({ event: "agent-unpriced-model", model });
  let dearest: TokenPrices | null = null;
  for (const candidate of table.values()) {
    if (dearest === null || candidate.output > dearest.output) {
      dearest = candidate;
    }
  }
  if (dearest === null) {
    throw new Error("AGENT_PRICES prices no model");
  }
  return dearest;
};

// ---- days ----

// the UTC day `now` falls in, as the ledger keys it, and when the next one starts
export const dayOf = (now: number): string => new Date(now).toISOString().slice(0, 10);

export const nextDayAt = (now: number): number => now - (now % DAY_MS) + DAY_MS;

// ---- what a reply cost ----

const cacheCreationSchema = z.looseObject({
  ephemeral_1h_input_tokens: z.number().int().nonnegative().nullish(),
  ephemeral_5m_input_tokens: z.number().int().nonnegative().nullish(),
});

const usagePartSchema = z.looseObject({
  cache_creation: cacheCreationSchema.nullish(),
  cache_creation_input_tokens: z.number().int().nonnegative().nullish(),
  cache_read_input_tokens: z.number().int().nonnegative().nullish(),
  input_tokens: z.number().int().nonnegative().nullish(),
  output_tokens: z.number().int().nonnegative().nullish(),
});

// a reply's usage as the API reports it, read at the cell's door
export const usageReportSchema = usagePartSchema.extend({
  iterations: z
    .array(usagePartSchema.extend({ model: z.string().nullish(), type: z.string() }))
    .nullish(),
});

// the tokens one call was billed, by category
interface UsageTokens {
  readonly input: number;
  readonly cacheRead: number;
  readonly cacheWrite5m: number;
  readonly cacheWrite1h: number;
  readonly output: number;
}

const tokensOf = (part: z.infer<typeof usagePartSchema>): UsageTokens => {
  const split = part.cache_creation;
  const written1h = split?.ephemeral_1h_input_tokens ?? 0;
  // a write the split does not attribute is a 5-minute one, the cheaper lifetime never assumed
  // past what the report says
  const written5m =
    split?.ephemeral_5m_input_tokens ??
    Math.max(0, (part.cache_creation_input_tokens ?? 0) - written1h);
  return {
    cacheRead: part.cache_read_input_tokens ?? 0,
    cacheWrite1h: written1h,
    cacheWrite5m: written5m,
    input: part.input_tokens ?? 0,
    output: part.output_tokens ?? 0,
  };
};

const costOf = (tokens: UsageTokens, prices: TokenPrices): number =>
  tokens.input * prices.input +
  tokens.cacheRead * prices.cacheRead +
  tokens.cacheWrite5m * prices.cacheWrite5m +
  tokens.cacheWrite1h * prices.cacheWrite1h +
  tokens.output * prices.output;

// a reply's usage at list price, in micro-cents: each of its iterations (the model asked, a
// fallback model, a compaction) at the prices of the model it names, one that names none, a
// compaction, which runs on the model asked, at `model`'s, the model the call went to; a reply with
// no iterations whole at `model`'s
export const priceUsage = (
  report: z.infer<typeof usageReportSchema>,
  model: string,
  table: PriceTable,
): number => {
  const iterations = report.iterations ?? [];
  if (iterations.length === 0) {
    return costOf(tokensOf(report), pricesFor(table, model));
  }
  let costUcents = 0;
  for (const iteration of iterations) {
    costUcents += costOf(tokensOf(iteration), pricesFor(table, iteration.model ?? model));
  }
  return costUcents;
};

// ---- the ledger ----

const spentSchema = z.object({ cost_ucents: z.number(), turns: z.number() });
const countSchema = z.object({ count: z.number() });

const spentOn = (sql: SqlStatements, day: string) => {
  const [row] = sql.all("SELECT turns, cost_ucents FROM agent_usage WHERE day = ?", [day]);
  return row === undefined ? { cost_ucents: 0, turns: 0 } : spentSchema.parse(row);
};

// how many more turns today allows, the waiting sends counted as taken; none once its cost is spent
export const turnsLeft = (sql: SqlStatements, allowance: Allowance, now: number): number => {
  const spent = spentOn(sql, dayOf(now));
  const [queued] = sql.all("SELECT count(*) AS count FROM agent_queue", []);
  return spent.cost_ucents >= allowance.dayCents * UCENTS_PER_CENT
    ? 0
    : Math.max(0, allowance.dayTurns - spent.turns - countSchema.parse(queued).count);
};

// a turn begun is booked on its day, so the allowance counts it from its start, and one Claude could
// not be reached for is given back on the day it was booked
export const bookTurn = (sql: SqlStatements, day: string, turns: 1 | -1): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, cost_ucents) VALUES (?, max(0, ?), 0)
     ON CONFLICT (day) DO UPDATE SET turns = max(0, turns + ?)`,
    [day, turns, turns],
  );
};

// what a reply cost, booked on the day its turn started
export const bookCost = (sql: SqlStatements, day: string, costUcents: number): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, cost_ucents) VALUES (?, 0, ?)
     ON CONFLICT (day) DO UPDATE SET cost_ucents = cost_ucents + excluded.cost_ucents`,
    [day, costUcents],
  );
};
