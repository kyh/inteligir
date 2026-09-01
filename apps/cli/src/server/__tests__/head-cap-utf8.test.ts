// The cap's boundary is the whole reason `headCapUtf8` exists: every prompt
// surface that budgets bytes (session instructions, note inference) calls this
// one answer, and a naive `string.slice` by length halves a surrogate pair and
// hands the model U+FFFD.

import { describe, expect, it } from "vitest";
import { headCapUtf8 } from "../head-cap-utf8";

function utf8Length(text: string): number {
  return new TextEncoder().encode(text).length;
}

describe("headCapUtf8", () => {
  it("returns text under the budget untouched", () => {
    expect(headCapUtf8("hello", 2_000)).toBe("hello");
  });

  it("cuts to exactly the byte budget for ASCII", () => {
    const text = "x".repeat(6_000);
    expect(utf8Length(headCapUtf8(text, 2_000))).toBe(2_000);
  });

  it("cuts on a code-point boundary, not a UTF-16 one", () => {
    // One ASCII byte then 4-byte code points, so the budget runs out three
    // bytes into the last one. Slicing by `string.length` would halve its
    // surrogate pair and hand the model U+FFFD.
    const emoji = "😀";
    const budget = 2_000;
    const cut = headCapUtf8(`a${emoji.repeat(budget / 4)}`, budget);
    expect(cut).not.toContain("�");
    expect(Array.from(cut)).toEqual(["a", ...Array<string>(499).fill(emoji)]);
    expect(utf8Length(cut)).toBeLessThanOrEqual(budget);
  });
});
