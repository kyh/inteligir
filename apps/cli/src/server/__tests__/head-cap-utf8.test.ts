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
    // one ASCII byte then 4-byte code points, so the budget runs out three bytes into the last one.
    const emoji = "😀";
    const budget = 2_000;
    const cut = headCapUtf8(`a${emoji.repeat(budget / 4)}`, budget);
    expect(cut).not.toContain("�");
    expect(Array.from(cut)).toEqual(["a", ...Array<string>(499).fill(emoji)]);
    expect(utf8Length(cut)).toBeLessThanOrEqual(budget);
  });
});
