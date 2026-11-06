// What a call may spend and what it cost (seeded, so a failure replays): a reservation covers what
// the call is billed whenever the cache bills it as guessed, a compaction's summarizing pass
// included, and overshoots by at most the prompt written cold when it does not; two threads
// reserving at once never pass the day's cap together; every list price is a whole number of
// micro-cents a token; a conversation resumed after a pause can still be sent at the compaction
// trigger; usage is priced by the model that answered each part of a reply, and a model the table
// does not price at its dearest row.

import { mulberry32 } from "@repo/notes/test-support/seeded-random";
import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { openCellLibrary } from "../library/cell-library";
import { agentCellIn, cellOf, inCell } from "../test-support/library-cell";
import { valueOf } from "../test-support/agent-turns";
import {
  agentPricesSchema,
  allowanceOf,
  dayOf,
  inputUcentsOf,
  MIN_MAX_TOKENS,
  nextDayAt,
  pricesFor,
  pricesOf,
  priceTableOf,
  priceUsage,
  reservationOf,
  resendReservationOf,
  settleCall,
  UCENTS_PER_CENT,
} from "./agent-allowance";
import type { ReservationLimits, TokenPrices } from "./agent-allowance";
import { reserveForCall } from "./agent-turns";
import { AGENT_MODEL } from "./library-agent";
import { COMPACTION_TRIGGER_TOKENS, deployedDefinition, tokensAtMost } from "./thread-request";
import { createThread, insertTurn } from "./turn-rows";
import type { CallEstimate } from "./thread-wire";

const MINUTE = 60_000;
const NOW = Date.UTC(2026, 9, 29, 12);

const prices = (): TokenPrices => pricesFor(pricesOf(env), AGENT_MODEL.id);

// a call's estimate: its prompt, the frozen part of it, and the call before it, of some age
const estimateOf = (rand: () => number): CallEstimate => {
  const frozenTokens = 1000 + Math.floor(rand() * 30_000);
  const promptTokens = frozenTokens + Math.floor(rand() * 60_000);
  const age = Math.floor(rand() * 3) === 0 ? null : Math.floor(rand() * 2 * 60 * MINUTE);
  return {
    frozenTokens,
    previous:
      age === null
        ? null
        : { endedAt: NOW - age, promptTokens: frozenTokens + Math.floor(rand() * 60_000) },
    promptTokens,
  };
};

// the estimate of a call that may compact: a prompt the estimate counts at the trigger or past it
const compactingEstimateOf = (rand: () => number): CallEstimate => {
  const estimate = estimateOf(rand);
  const promptTokens = COMPACTION_TRIGGER_TOKENS + Math.floor(rand() * 60_000);
  return {
    ...estimate,
    frozenTokens: Math.min(estimate.frozenTokens, promptTokens),
    promptTokens,
  };
};

const limitsOf = (rand: () => number): ReservationLimits => ({
  dayUcents: Math.floor(rand() * 200 * UCENTS_PER_CENT),
  turnUcents: Math.floor(rand() * 60 * UCENTS_PER_CENT),
});

// a fraction of a count, as a real tokenizer counts fewer tokens than characters / 3
const part = (rand: () => number, of: number): number => Math.floor(rand() * (of + 1));

describe("a call's reservation", () => {
  it("covers its billed usage whenever the cache bills as guessed (seeded)", () => {
    const rand = mulberry32(0x5e_7c);
    const table = pricesOf(env);
    let granted = 0;
    for (let run = 0; run < 5000; run += 1) {
      const estimate = estimateOf(rand);
      const answer = reservationOf(estimate, prices(), limitsOf(rand), NOW);
      if (answer.kind === "refused") {
        continue;
      }
      granted += 1;
      expect(answer.maxTokens).toBeGreaterThanOrEqual(MIN_MAX_TOKENS);
      expect(answer.maxTokens).toBeLessThanOrEqual(64_000);
      // the prompt as billed: no more tokens than estimated, read and written as the guess was
      const { frozenTokens, previous, promptTokens } = estimate;
      const prompt = part(rand, promptTokens);
      const age = previous === null ? Number.POSITIVE_INFINITY : NOW - previous.endedAt;
      const cached =
        previous !== null && age <= 5 * MINUTE
          ? Math.min(previous.promptTokens, prompt)
          : Math.min(frozenTokens, prompt);
      const warm = age <= 60 * MINUTE;
      const usage = {
        cache_creation: {
          ephemeral_1h_input_tokens: warm ? 0 : cached,
          ephemeral_5m_input_tokens: prompt - cached,
        },
        cache_read_input_tokens: warm ? cached : 0,
        input_tokens: 0,
        output_tokens: part(rand, answer.maxTokens),
      };
      const billed = priceUsage(usage, AGENT_MODEL.id, table);
      expect(billed.costUcents).toBeLessThanOrEqual(answer.reservedUcents);
      expect(Number.isInteger(answer.reservedUcents)).toBe(true);
    }
    expect(granted).toBeGreaterThan(1000);
  });

  // a call that compacts is billed two passes (`usage.iterations`): the summary, which reads the
  // whole prompt as the estimate guessed the cache would bill it and writes at most the cap, then
  // the answer, which reads the frozen system and tools and takes the summary as new input
  it("covers a compaction's summarizing pass beside its answer whenever the cache bills as guessed (seeded)", () => {
    const rand = mulberry32(0xc0_3a);
    const table = pricesOf(env);
    let granted = 0;
    for (let run = 0; run < 5000; run += 1) {
      const estimate = compactingEstimateOf(rand);
      // room past a turn's ceiling, since a long prompt's input alone takes most of one
      const room = Math.floor(rand() * 300 * UCENTS_PER_CENT);
      const answer = reservationOf(estimate, prices(), { dayUcents: room, turnUcents: room }, NOW);
      if (answer.kind === "refused") {
        continue;
      }
      granted += 1;
      const { frozenTokens, previous, promptTokens } = estimate;
      const prompt = part(rand, promptTokens);
      const age = previous === null ? Number.POSITIVE_INFINITY : NOW - previous.endedAt;
      const cached =
        previous !== null && age <= 5 * MINUTE
          ? Math.min(previous.promptTokens, prompt)
          : Math.min(frozenTokens, prompt);
      const warm = age <= 60 * MINUTE;
      const summary = part(rand, answer.maxTokens);
      // the answer's prompt after the summary: written to the cache, or sent bare
      const summaryWritten = rand() < 0.5;
      const iterations = [
        {
          cache_creation: {
            ephemeral_1h_input_tokens: warm ? 0 : cached,
            ephemeral_5m_input_tokens: prompt - cached,
          },
          cache_read_input_tokens: warm ? cached : 0,
          input_tokens: 0,
          output_tokens: summary,
          type: "compaction",
        },
        {
          cache_creation: {
            ephemeral_1h_input_tokens: 0,
            ephemeral_5m_input_tokens: summaryWritten ? summary : 0,
          },
          cache_read_input_tokens: Math.min(frozenTokens, prompt),
          input_tokens: summaryWritten ? 0 : summary,
          output_tokens: part(rand, answer.maxTokens),
          type: "message",
        },
      ];
      const billed = priceUsage({ iterations }, AGENT_MODEL.id, table);
      expect(billed.costUcents).toBeLessThanOrEqual(answer.reservedUcents);
      expect(Number.isInteger(answer.reservedUcents)).toBe(true);
      // and a step sent again at its first cap is held to the same bound
      const again = resendReservationOf(
        estimate,
        prices(),
        answer.maxTokens,
        { dayUcents: Number.MAX_SAFE_INTEGER, turnUcents: 0 },
        NOW,
      );
      expect(again).toEqual(answer);
    }
    expect(granted).toBeGreaterThan(1000);
  });

  it("prices a prompt the estimate counts under the compaction trigger as one pass", () => {
    const estimate = {
      frozenTokens: 20_000,
      previous: null,
      promptTokens: COMPACTION_TRIGGER_TOKENS - 1,
    };
    const room = { dayUcents: Number.MAX_SAFE_INTEGER, turnUcents: Number.MAX_SAFE_INTEGER };
    const input = inputUcentsOf(estimate, prices(), NOW);
    expect(reservationOf(estimate, prices(), room, NOW)).toEqual({
      kind: "granted",
      maxTokens: 64_000,
      reservedUcents: input + 64_000 * prices().output,
    });
    // one token more, and the summary's pass is priced beside the answer
    const reaching = { ...estimate, promptTokens: COMPACTION_TRIGGER_TOKENS };
    expect(reservationOf(reaching, prices(), room, NOW)).toEqual({
      kind: "granted",
      maxTokens: 64_000,
      reservedUcents:
        inputUcentsOf(reaching, prices(), NOW) +
        20_000 * prices().cacheRead +
        64_000 * (2 * prices().output + prices().cacheWrite5m),
    });
  });

  it("overshoots a colder cache than it guessed by at most the prompt written cold (seeded)", () => {
    const rand = mulberry32(0xc0_1d);
    const table = pricesOf(env);
    const price = prices();
    for (let run = 0; run < 5000; run += 1) {
      const compacts = rand() < 0.5;
      const estimate = compacts ? compactingEstimateOf(rand) : estimateOf(rand);
      const answer = reservationOf(estimate, price, limitsOf(rand), NOW);
      if (answer.kind === "refused") {
        continue;
      }
      // nothing read: the frozen part written for the hour, the rest for five minutes
      const prompt = part(rand, estimate.promptTokens);
      const frozen = Math.min(estimate.frozenTokens, prompt);
      const cold = {
        cache_creation: {
          ephemeral_1h_input_tokens: frozen,
          ephemeral_5m_input_tokens: prompt - frozen,
        },
        cache_read_input_tokens: 0,
        input_tokens: 0,
        output_tokens: part(rand, answer.maxTokens),
      };
      // a compaction's answer finds even the frozen part cold, and writes the summary
      const summary = part(rand, answer.maxTokens);
      const usage = compacts
        ? {
            iterations: [
              { ...cold, output_tokens: summary, type: "compaction" },
              {
                cache_creation: {
                  ephemeral_1h_input_tokens: frozen,
                  ephemeral_5m_input_tokens: summary,
                },
                cache_read_input_tokens: 0,
                input_tokens: 0,
                output_tokens: part(rand, answer.maxTokens),
                type: "message",
              },
            ],
          }
        : cold;
      const billed = priceUsage(usage, AGENT_MODEL.id, table);
      // each pass's prompt written cold, at most: the summary's whole, the answer's frozen part
      const coldTokens = estimate.promptTokens + (compacts ? estimate.frozenTokens : 0);
      expect(billed.costUcents - answer.reservedUcents).toBeLessThanOrEqual(
        coldTokens * (price.cacheWrite1h - price.cacheRead),
      );
    }
  });

  it("is refused when what is left buys too short an answer, and caps a long one", () => {
    const estimate = { frozenTokens: 20_000, previous: null, promptTokens: 30_000 };
    const input = inputUcentsOf(estimate, prices(), NOW);
    const room = { dayUcents: Number.MAX_SAFE_INTEGER, turnUcents: Number.MAX_SAFE_INTEGER };
    expect(reservationOf(estimate, prices(), room, NOW)).toMatchObject({ maxTokens: 64_000 });
    const short = input + (MIN_MAX_TOKENS - 1) * prices().output;
    expect(reservationOf(estimate, prices(), { dayUcents: short, turnUcents: short }, NOW)).toEqual(
      { kind: "refused" },
    );
    // a step sent again keeps its first cap, whatever the turn has left, while the day holds it
    const again = resendReservationOf(
      estimate,
      prices(),
      3000,
      { dayUcents: input + 3000 * prices().output, turnUcents: 0 },
      NOW,
    );
    expect(again).toMatchObject({ kind: "granted", maxTokens: 3000 });
    expect(
      resendReservationOf(estimate, prices(), 3000, { dayUcents: input, turnUcents: 0 }, NOW),
    ).toEqual({ kind: "refused" });
  });

  it("grants a conversation resumed after a pause at the compaction trigger, its summary's pass priced, and would refuse one at the API's default", () => {
    const definition = deployedDefinition();
    const frozenTokens = tokensAtMost(
      JSON.stringify(definition.system).length + JSON.stringify(definition.tools).length,
    );
    const turn = allowanceOf(env).turnCents * UCENTS_PER_CENT;
    const fresh = { dayUcents: turn, turnUcents: turn };
    // a turn's first call, `idleMs` after the last: a prompt of `tokens` real tokens in a body of
    // `chars` characters a token, which the estimate counts a third of
    const resumed = (tokens: number, chars: number, idleMs: number): CallEstimate => ({
      frozenTokens,
      previous: { endedAt: NOW - idleMs, promptTokens: tokens },
      promptTokens: tokensAtMost(tokens * chars),
    });
    for (const idleMs of [6 * MINUTE, 61 * MINUTE, 24 * 60 * MINUTE]) {
      const label = `idle ${String(idleMs / MINUTE)} minutes`;
      // four characters a token, the estimate a third again the real count: past the trigger by
      // as much, so the summary's pass is priced beside the answer
      const atTrigger = resumed(COMPACTION_TRIGGER_TOKENS, 4, idleMs);
      expect(atTrigger.promptTokens, label).toBeGreaterThan(COMPACTION_TRIGGER_TOKENS);
      expect(reservationOf(atTrigger, prices(), fresh, NOW).kind, label).toBe("granted");
      // three characters a token, the estimate the real count: the input alone outgrows the turn
      const atDefault = resumed(150_000, 3, idleMs);
      expect(inputUcentsOf(atDefault, prices(), NOW), label).toBeGreaterThan(turn);
      expect(reservationOf(atDefault, prices(), fresh, NOW), label).toEqual({ kind: "refused" });
    }
  });

  // two threads, a thousand calls between them, each reservation and settlement a cell transaction
  it(
    "never lets two threads together reserve past the day's cap (seeded)",
    { timeout: 30_000 },
    async () => {
      await inCell(cellOf(), (state) => {
        const library = openCellLibrary(state, env);
        const cell = agentCellIn(state, library);
        const threads = ["thread-a", "thread-b"];
        valueOf(
          library.landApart({ answer: z.null(), opId: undefined }, (scope) => {
            for (const threadId of threads) {
              createThread(scope, threadId, "Spend.");
              insertTurn(scope.storage, {
                at: scope.now,
                message: { text: "Spend.", viewContext: null },
                threadId,
                turn: 1,
              });
            }
            return null;
          }),
        );
        const rand = mulberry32(0xda_7e);
        const allowance = allowanceOf(env);
        // the day is shared across the threads: lift the turn's ceiling past it, so only the day binds
        const shared = { ...env, AGENT_ALLOWANCE: { ...allowance, turnCents: 10_000 } };
        const sharedCell = { ...cell, env: shared };
        const day = allowance.dayCents * UCENTS_PER_CENT;
        const open: { readonly callId: string; readonly reserved: number }[] = [];
        const sumSchema = z.object({ total: z.number() });
        for (let call = 0; call < 1000; call += 1) {
          if (open.length > 0 && rand() < 0.4) {
            const [settling] = open.splice(Math.floor(rand() * open.length), 1);
            if (settling !== undefined) {
              valueOf(
                library.landApart({ answer: z.null(), opId: undefined }, (scope) => {
                  settleCall(scope.storage, settling.callId, {
                    costUcents: Math.floor(rand() * settling.reserved),
                    tokens: { cacheRead: 0, cacheWrite1h: 0, cacheWrite5m: 0, input: 0, output: 0 },
                  });
                  return null;
                }),
              );
            }
          }
          const callId = `call-${String(call)}`;
          const answer = reserveForCall(sharedCell, {
            callId,
            estimate: {
              frozenTokens: 1000,
              previous: null,
              promptTokens: 1000 + Math.floor(rand() * 20_000),
            },
            model: AGENT_MODEL.id,
            resend: null,
            threadId: threads[call % 2] ?? "thread-a",
            turn: 1,
          });
          if (answer.ok && answer.value.kind === "granted") {
            const [row] = state.storage.sql
              .exec("SELECT reserved_ucents AS total FROM agent_calls WHERE call_id = ?", callId)
              .toArray();
            open.push({ callId, reserved: sumSchema.parse(row).total });
          }
          const [spent] = state.storage.sql
            .exec("SELECT coalesce(sum(cost_ucents), 0) AS total FROM agent_usage")
            .toArray();
          const [held] = state.storage.sql
            .exec(
              "SELECT coalesce(sum(reserved_ucents), 0) AS total FROM agent_calls WHERE cost_ucents IS NULL",
            )
            .toArray();
          expect(sumSchema.parse(spent).total + sumSchema.parse(held).total).toBeLessThanOrEqual(
            day,
          );
        }
      });
    },
  );
});

describe("the prices", () => {
  it("are each a whole number of micro-cents a token, and a third decimal is refused", () => {
    for (const [model, row] of pricesOf(env)) {
      for (const [category, ucents] of Object.entries(row)) {
        expect(Number.isInteger(ucents), `${model} ${category}`).toBe(true);
      }
    }
    const row = { cacheRead: 0.2, cacheWrite1h: 8, cacheWrite5m: 5, input: 4, output: 20 };
    expect(agentPricesSchema.validate({ model: row })).toBe(true);
    expect(agentPricesSchema.validate({ model: { ...row, cacheRead: 0.125 } })).toBe(false);
  });

  it("price each part of a reply by the model that answered it, at list price by category", () => {
    const table = priceTableOf(agentPricesSchema.parse(env.AGENT_PRICES));
    const tokens = {
      cache_creation: { ephemeral_1h_input_tokens: 100, ephemeral_5m_input_tokens: 200 },
      cache_read_input_tokens: 300,
      input_tokens: 400,
      output_tokens: 500,
    };
    // claude-opus-5-5 in micro-cents a token: 400, 2000, 20, 500, 800
    const whole = 400 * 400 + 500 * 2000 + 300 * 20 + 200 * 500 + 100 * 800;
    expect(priceUsage(tokens, "claude-opus-5-5", table)).toEqual({
      costUcents: whole,
      tokens: { cacheRead: 300, cacheWrite1h: 100, cacheWrite5m: 200, input: 400, output: 500 },
    });
    // a fallback's reply: the declined hop at the asked model's prices, the answer at its own
    const fallen = priceUsage(
      {
        ...tokens,
        iterations: [
          { ...tokens, model: "claude-opus-5-5", output_tokens: 8, type: "message" },
          { ...tokens, model: "claude-opus-5", type: "fallback_message" },
        ],
      },
      "claude-opus-5-5",
      table,
    );
    const declined = whole - 500 * 2000 + 8 * 2000;
    // claude-opus-5 in micro-cents a token: 500, 2500, 50, 625, 1000
    const answered = 400 * 500 + 500 * 2500 + 300 * 50 + 200 * 625 + 100 * 1000;
    expect(fallen.costUcents).toBe(declined + answered);
    expect(fallen.tokens.output).toBe(508);
  });

  it("price a model the table does not hold at its dearest row, and say so", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = pricesOf(env);
    expect(pricesFor(table, "claude-unknown-9")).toEqual(pricesFor(table, "claude-opus-5"));
    expect(logged).toHaveBeenCalledWith({
      event: "agent-unpriced-model",
      model: "claude-unknown-9",
    });
    logged.mockRestore();
  });
});

describe("the day", () => {
  it("is the UTC day, and fills again at the next UTC midnight", () => {
    expect(dayOf(NOW)).toBe("2026-10-29");
    expect(nextDayAt(NOW)).toBe(Date.UTC(2026, 9, 30));
    expect(nextDayAt(Date.UTC(2026, 9, 30))).toBe(Date.UTC(2026, 9, 31));
  });
});
