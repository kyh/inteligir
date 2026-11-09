// What the built-in agent may spend for one account, and what each call cost (owner decision:
// about fifty free turns a month, held first as a day's share). The numbers are the deployment's
// own data, `AGENT_ALLOWANCE` and `AGENT_PRICES` in cloudflare.config.ts, never code. A send is
// counted as a turn when it is let in; each model call is reserved before it is sent, its
// `max_tokens` what the turn's ceiling and the day's remainder buy after its input, the input
// priced as the cache will most likely bill it, and a call whose prompt may reach the compaction
// trigger priced with the summarizing pass that may run first; and each reply settles at its exact
// usage at list price. Money is integer micro-cents throughout: a price of two decimals in dollars
// a million tokens is a whole number of micro-cents a token, so nothing rounds.

import type { SqlStatements } from "@repo/service/library/library-sql";
import { z } from "zod";

import { AGENT_MAX_TOKENS } from "./library-agent";
import { COMPACTION_TRIGGER_TOKENS } from "./thread-request";
import type { CallEstimate } from "./thread-wire";

const DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MINUTES_MS = 5 * 60_000;
const HOUR_MS = 60 * 60_000;

// micro-cents a cent
/** @internal */
export const UCENTS_PER_CENT = 1_000_000;

// below this an answer has no room to be one, and the call is not made
/** @internal */
export const MIN_MAX_TOKENS = 2048;

const allowanceSchema = z.object({
  // the turns that may run at once across the account's threads
  concurrentTurns: z.number().int().positive(),
  // the list cost in cents a UTC day allows, and one turn's ceiling
  dayCents: z.number().int().positive(),
  dayTurns: z.number().int().positive(),
  turnCents: z.number().int().positive(),
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
export interface TokenPrices {
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

// ---- the reservation ----

export interface ReservationLimits {
  // what the turn's ceiling has left, its open reservations taken out
  readonly turnUcents: number;
  // what the day has left, every open reservation of the account taken out
  readonly dayUcents: number;
}

export type ReservationAnswer =
  | {
      readonly kind: "granted";
      readonly maxTokens: number;
      readonly reservedUcents: number;
    }
  | { readonly kind: "refused" };

// the input as the cache will most likely bill it: within five minutes of the previous call its
// prompt is read and the rest written for five minutes; within the hour the frozen system and
// tools are read; past it they are written for the hour
/** @internal */
export const inputUcentsOf = (estimate: CallEstimate, prices: TokenPrices, now: number): number => {
  const { frozenTokens, previous, promptTokens } = estimate;
  const age = previous === null ? Number.POSITIVE_INFINITY : now - previous.endedAt;
  if (previous !== null && age <= FIVE_MINUTES_MS) {
    const read = Math.min(previous.promptTokens, promptTokens);
    return read * prices.cacheRead + (promptTokens - read) * prices.cacheWrite5m;
  }
  const frozen = Math.min(frozenTokens, promptTokens);
  const rest = (promptTokens - frozen) * prices.cacheWrite5m;
  return age <= HOUR_MS ? frozen * prices.cacheRead + rest : frozen * prices.cacheWrite1h + rest;
};

// What a call costs at a cap of `maxTokens`, as `fixed + maxTokens × perToken`. A call whose
// estimate reaches the compaction trigger may be two sampling passes, each billed
// (platform.claude.com/docs/en/build-with-claude/compaction-threshold#understanding-usage): the
// summary, whose pass reads the whole prompt, priced as the estimate already prices it, and writes
// at most `max_tokens`, which caps a summarizing pass
// (platform.claude.com/docs/en/build-with-claude/compaction-on-demand#request-a-summary); then the
// answer, whose prompt is the frozen system and tools, read from the cache the summary's pass just
// used, and the summary, new input; and its output, at most `max_tokens`. Below the trigger the
// estimate, which counts at least the tokens the prompt holds (`callEstimateOf` in
// `./thread-request`), says the API cannot compact. A fallback's pass is priced by neither: with it
// reserved, a cold first call at a turn's ceiling buys under `MIN_MAX_TOKENS` and is refused, so a
// decline books past its reservation, and one that takes the turn past its ceiling leaves its next
// call nothing.
interface CallCost {
  readonly fixed: number;
  readonly perToken: number;
}

const callCostOf = (estimate: CallEstimate, prices: TokenPrices, now: number): CallCost => {
  const inputUcents = inputUcentsOf(estimate, prices, now);
  if (estimate.promptTokens < COMPACTION_TRIGGER_TOKENS) {
    return { fixed: inputUcents, perToken: prices.output };
  }
  const frozen = Math.min(estimate.frozenTokens, estimate.promptTokens);
  // the summary as the answer's input: written to the cache, or sent bare, whichever costs more
  const summaryInput = Math.max(prices.cacheWrite5m, prices.input);
  return {
    fixed: inputUcents + frozen * prices.cacheRead,
    perToken: 2 * prices.output + summaryInput,
  };
};

// the call's cap: what is left of the smaller limit after its input, in output tokens, at most
// the agent's ceiling; too little to answer in is no call
export const reservationOf = (
  estimate: CallEstimate,
  prices: TokenPrices,
  limits: ReservationLimits,
  now: number,
): ReservationAnswer => {
  const cost = callCostOf(estimate, prices, now);
  const available = Math.min(limits.turnUcents, limits.dayUcents) - cost.fixed;
  const maxTokens = Math.min(
    AGENT_MAX_TOKENS,
    cost.perToken === 0 ? AGENT_MAX_TOKENS : Math.floor(available / cost.perToken),
  );
  if (maxTokens < MIN_MAX_TOKENS) {
    return { kind: "refused" };
  }
  return { kind: "granted", maxTokens, reservedUcents: cost.fixed + maxTokens * cost.perToken };
};

// a step sent again after a cut or a failure, at the cap it was first sent with, so its bytes are
// those it first went out with: the turn's ceiling, already spent once on this step, is not asked
// again, and every try cut books its reservation against the day, so the day alone bounds what a
// step's tries cost
export const resendReservationOf = (
  estimate: CallEstimate,
  prices: TokenPrices,
  maxTokens: number,
  limits: ReservationLimits,
  now: number,
): ReservationAnswer => {
  const cost = callCostOf(estimate, prices, now);
  const reservedUcents = cost.fixed + maxTokens * cost.perToken;
  return reservedUcents > limits.dayUcents
    ? { kind: "refused" }
    : { kind: "granted", maxTokens, reservedUcents };
};

// ---- the settlement ----

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
const sumSchema = z.object({ total: z.number() });

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

// a turn begun is booked on its day, so the allowance counts it from its start, and one that cost
// nothing is given back on the day it was booked
export const bookTurn = (sql: SqlStatements, day: string, turns: 1 | -1): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, cost_ucents) VALUES (?, max(0, ?), 0)
     ON CONFLICT (day) DO UPDATE SET turns = max(0, turns + ?)`,
    [day, turns, turns],
  );
};

const bookCost = (sql: SqlStatements, day: string, costUcents: number): void => {
  sql.run(
    `INSERT INTO agent_usage (day, turns, cost_ucents) VALUES (?, 0, ?)
     ON CONFLICT (day) DO UPDATE SET cost_ucents = cost_ucents + excluded.cost_ucents`,
    [day, costUcents],
  );
};

const callRowSchema = z.object({
  cost_ucents: z.number().nullable(),
  day: z.string(),
  max_tokens: z.number(),
  reserved_ucents: z.number(),
});

export const heldReservation = (sql: SqlStatements, callId: string) => {
  const [row] = sql.all(
    "SELECT day, reserved_ucents, max_tokens, cost_ucents FROM agent_calls WHERE call_id = ?",
    [callId],
  );
  return row === undefined ? null : callRowSchema.parse(row);
};

// what the turn and the day have left to reserve: the turn's calls at what they cost or hold, but
// a cut one, which the day pays for and whose step is sent again with the turn's room
export const limitsOf = (
  sql: SqlStatements,
  turn: { readonly threadId: string; readonly turn: number },
  allowance: Allowance,
  now: number,
): ReservationLimits => {
  const [turnSpent] = sql.all(
    `SELECT coalesce(sum(coalesce(cost_ucents, reserved_ucents)), 0) AS total FROM agent_calls
     WHERE thread_id = ? AND turn = ? AND cut = 0`,
    [turn.threadId, turn.turn],
  );
  const [open] = sql.all(
    "SELECT coalesce(sum(reserved_ucents), 0) AS total FROM agent_calls WHERE cost_ucents IS NULL",
    [],
  );
  const daySpent = spentOn(sql, dayOf(now)).cost_ucents;
  return {
    dayUcents: allowance.dayCents * UCENTS_PER_CENT - daySpent - sumSchema.parse(open).total,
    turnUcents: allowance.turnCents * UCENTS_PER_CENT - sumSchema.parse(turnSpent).total,
  };
};

export const recordReservation = (
  sql: SqlStatements,
  call: {
    readonly callId: string;
    readonly threadId: string;
    readonly turn: number;
    readonly maxTokens: number;
    readonly reservedUcents: number;
  },
  now: number,
): void => {
  sql.run(
    `INSERT INTO agent_calls (call_id, thread_id, turn, day, reserved_ucents, max_tokens)
     VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (call_id) DO NOTHING`,
    [call.callId, call.threadId, call.turn, dayOf(now), call.reservedUcents, call.maxTokens],
  );
};

// a call settled once, on the day it was reserved: at its usage's price in micro-cents, at its
// reservation when it was cut short, or at nothing when the API answered it with an error
export const settleCall = (
  sql: SqlStatements,
  callId: string,
  settlement: number | "reserved" | "free",
): void => {
  const held = heldReservation(sql, callId);
  if (held?.cost_ucents !== null) {
    return;
  }
  let costUcents = 0;
  if (settlement === "reserved") {
    costUcents = held.reserved_ucents;
  } else if (settlement !== "free") {
    costUcents = settlement;
  }
  sql.run("UPDATE agent_calls SET cost_ucents = ?, cut = ? WHERE call_id = ?", [
    costUcents,
    settlement === "reserved" ? 1 : 0,
    callId,
  ]);
  bookCost(sql, held.day, costUcents);
};

const openCallSchema = z.object({ call_id: z.string() });

// what a turn ending settles: every call still open booked at what it reserved, since it may have
// cost that much; and what the turn cost in all
export const settleTurnCalls = (
  sql: SqlStatements,
  turn: { readonly threadId: string; readonly turn: number },
): number => {
  for (const raw of sql.all(
    "SELECT call_id FROM agent_calls WHERE thread_id = ? AND turn = ? AND cost_ucents IS NULL",
    [turn.threadId, turn.turn],
  )) {
    settleCall(sql, openCallSchema.parse(raw).call_id, "reserved");
  }
  const [row] = sql.all(
    "SELECT coalesce(sum(cost_ucents), 0) AS total FROM agent_calls WHERE thread_id = ? AND turn = ?",
    [turn.threadId, turn.turn],
  );
  return sumSchema.parse(row).total;
};
