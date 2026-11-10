// What a reply cost: every list price is a whole number of micro-cents a token, usage is priced by
// the model that answered each part of a reply, a model the table does not price at its dearest
// row, and the day is UTC's.

import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import {
  agentPricesSchema,
  dayOf,
  nextDayAt,
  pricesFor,
  pricesOf,
  priceTableOf,
  priceUsage,
} from "./agent-allowance";

const NOW = Date.UTC(2026, 9, 29, 12);

describe("the prices", () => {
  it("are each a whole number of micro-cents a token, and a third decimal is refused", () => {
    for (const [model, row] of pricesOf(env)) {
      for (const [category, ucents] of Object.entries(row)) {
        expect(Number.isInteger(ucents), `${model} ${category}`).toBe(true);
      }
    }
    const row = { cacheRead: 0.1, cacheWrite1h: 4, cacheWrite5m: 2.5, input: 2, output: 10 };
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
    // claude-sonnet-5-5 in micro-cents a token: 200, 1000, 10, 250, 400
    const whole = 400 * 200 + 500 * 1000 + 300 * 10 + 200 * 250 + 100 * 400;
    expect(priceUsage(tokens, "claude-sonnet-5-5", table)).toBe(whole);
    // a fallback's reply: the declined hop at the asked model's prices, the answer at its own
    const fallen = priceUsage(
      {
        ...tokens,
        iterations: [
          { ...tokens, model: "claude-sonnet-5-5", output_tokens: 8, type: "message" },
          { ...tokens, model: "claude-sonnet-5", type: "fallback_message" },
        ],
      },
      "claude-sonnet-5-5",
      table,
    );
    const declined = whole - 500 * 1000 + 8 * 1000;
    // claude-sonnet-5 in micro-cents a token: 200, 1000, 20, 250, 400
    const answered = 400 * 200 + 500 * 1000 + 300 * 20 + 200 * 250 + 100 * 400;
    expect(fallen).toBe(declined + answered);
  });

  it("price a model the table does not hold at its dearest row, and say so", () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const table = pricesOf(env);
    expect(pricesFor(table, "claude-unknown-9")).toStrictEqual(pricesFor(table, "claude-sonnet-5"));
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
