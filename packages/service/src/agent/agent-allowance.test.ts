// The allowance's day is UTC's.

import { describe, expect, it } from "vitest";

import { dayOf, nextDayAt } from "./agent-allowance";

const NOW = Date.UTC(2026, 9, 29, 12);

describe("the day", () => {
  it("is the UTC day, and fills again at the next UTC midnight", () => {
    expect(dayOf(NOW)).toBe("2026-10-29");
    expect(nextDayAt(NOW)).toBe(Date.UTC(2026, 9, 30));
    expect(nextDayAt(Date.UTC(2026, 9, 30))).toBe(Date.UTC(2026, 9, 31));
  });
});
