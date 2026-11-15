import { describe, expect, it } from "vitest";

import { excerptAround, isPrintableAscii } from "./search-hits";

describe("the excerpt around a match", () => {
  it("clips both sides and marks the cut", () => {
    const line = `${"a".repeat(60)}NEEDLE${"b".repeat(120)}`;
    expect(excerptAround(line, { length: 6, offset: 60 })).toBe(
      `…${"a".repeat(40)}NEEDLE${"b".repeat(80)}…`,
    );
  });
});

describe("a needle SQLite folds as the matcher does", () => {
  it("is printable ascii on one line", () => {
    expect(isPrintableAscii("deploy now")).toBe(true);
    expect(isPrintableAscii("acción")).toBe(false);
    expect(isPrintableAscii("a\tb")).toBe(false);
    expect(isPrintableAscii("a\nb")).toBe(false);
  });
});
