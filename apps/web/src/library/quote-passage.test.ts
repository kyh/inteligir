import { describe, expect, it } from "vitest";

import { quotePassage } from "./quote-passage";

describe("a passage the person asked the agent about", () => {
  it("is quoted on lines of its own and once", () => {
    const quote = "> first\n> second\n\n";
    expect(quotePassage("", "first\nsecond")).toBe(quote);
    expect(quotePassage("Compare these.\n", "first\nsecond")).toBe(`Compare these.\n\n${quote}`);
    expect(quotePassage(quote, "first\nsecond")).toBe(quote);
  });
});
