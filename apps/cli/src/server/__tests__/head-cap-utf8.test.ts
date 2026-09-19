import { describe, expect, it } from "vitest";
import { headCapUtf8 } from "../head-cap-utf8";

const utf8Length = (text: string): number => new TextEncoder().encode(text).length;

describe("headCapUtf8", () => {
  it("returns text under the budget untouched", () => {
    expect(headCapUtf8("hello", 2000)).toBe("hello");
  });

  it("cuts to exactly the byte budget for ASCII", () => {
    const text = "x".repeat(6000);
    expect(utf8Length(headCapUtf8(text, 2000))).toBe(2000);
  });

  it("cuts on a code-point boundary, not a UTF-16 one", () => {
    // one ASCII byte then 4-byte code points, so the budget runs out three bytes into the last one.
    const emoji = "😀";
    const budget = 2000;
    const cut = headCapUtf8(`a${emoji.repeat(budget / 4)}`, budget);
    expect(cut).not.toContain("�");
    expect(cut).toBe(`a${emoji.repeat(499)}`);
    expect(utf8Length(cut)).toBeLessThanOrEqual(budget);
  });
});
