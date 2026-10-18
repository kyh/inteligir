import { describe, expect, it } from "vitest";

import { ANNOTATION_QUOTE_MAX, clipQuote } from "./store-schema";

describe("clipQuote", () => {
  it("folds whitespace and keeps a short quote whole", () => {
    expect(clipQuote("  a\n\tb   c ")).toBe("a b c");
  });

  it("cuts a long quote at a word boundary with a trailing ellipsis", () => {
    const words = Array.from({ length: 2000 }, (_, i) => `w${String(i)}`).join(" ");
    const clipped = clipQuote(words);
    expect(clipped.length).toBeLessThanOrEqual(ANNOTATION_QUOTE_MAX);
    expect(clipped.endsWith("…")).toBe(true);
    expect(words.startsWith(`${clipped.slice(0, -1)} `)).toBe(true);
  });

  it("cuts a word longer than the room inside it, never inside a surrogate pair", () => {
    expect(clipQuote("x".repeat(5000))).toBe(`${"x".repeat(ANNOTATION_QUOTE_MAX - 1)}…`);
    const emoji = clipQuote("😀".repeat(3000));
    expect(emoji.length).toBeLessThanOrEqual(ANNOTATION_QUOTE_MAX);
    expect(emoji.slice(0, -1).replaceAll("😀", "")).toBe("");
  });
});
