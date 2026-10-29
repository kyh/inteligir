// What a turn may spend: the cap a session is given before each turn always stands above what it
// consumed, by at most the day's remainder and a turn's ceiling and at least a cent, and is the
// integer string of cents a budget takes, whatever the figures (seeded, so a failure replays).

import { mulberry32 } from "@repo/notes/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import { budgetOf, nextDayAt, turnCap } from "./agent-allowance";

describe("a turn's cap", () => {
  it("stays above what its session consumed and within what the turn may spend (seeded)", () => {
    const rand = mulberry32(0x7b_cd);
    const cents = (most: number): number => Math.floor(rand() * most);
    for (let run = 0; run < 5000; run += 1) {
      const spend = {
        ceilingCents: 1 + cents(200),
        consumedCents: cents(100_000),
        remainingCents: cents(300),
      };
      const cap = turnCap(spend);
      expect(Number.isInteger(cap)).toBe(true);
      expect(cap).toBeGreaterThanOrEqual(spend.consumedCents + 1);
      expect(cap - spend.consumedCents).toBeLessThanOrEqual(
        Math.max(1, Math.min(spend.remainingCents, spend.ceilingCents)),
      );
      expect(budgetOf(cap)).toEqual({
        max_list_cost: { amount: String(cap), currency: "USD" },
        type: "limit",
      });
      expect(budgetOf(cap).max_list_cost.amount).toMatch(/^[1-9]\d*$/u);
    }
  });

  it("gives a day with nothing left one cent, which the platform stops the turn at", () => {
    expect(turnCap({ ceilingCents: 50, consumedCents: 120, remainingCents: 0 })).toBe(121);
    expect(turnCap({ ceilingCents: 50, consumedCents: 0, remainingCents: 1000 })).toBe(50);
    expect(turnCap({ ceilingCents: 50, consumedCents: 7, remainingCents: 20 })).toBe(27);
  });

  it("fills again at the next UTC midnight", () => {
    const noon = Date.UTC(2026, 9, 29, 12);
    expect(nextDayAt(noon)).toBe(Date.UTC(2026, 9, 30));
    expect(nextDayAt(Date.UTC(2026, 9, 30))).toBe(Date.UTC(2026, 9, 31));
  });
});
