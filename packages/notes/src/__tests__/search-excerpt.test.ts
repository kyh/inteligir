import { describe, expect, it } from "vitest";

import { SEARCH_EXCERPT_SCAN_CHARS, searchExcerpt } from "../knowledge/search-excerpt";
import { planSearchQuery } from "../knowledge/search-query";

const termsOf = (query: string) => planSearchQuery(query)[0]?.terms ?? [];

describe("the search excerpt", () => {
  it("cuts the first line holding a term, its stem or its typed prefix, across terminators", () => {
    const body = "# Title\r\n\r\nnothing here\rI was exhausted lately\nmore\n";
    expect(searchExcerpt(body, termsOf("exhausting"))).toBe("I was exhausted lately");
    expect(searchExcerpt(body, termsOf("exha"))).toBe("I was exhausted lately");
  });

  it("stops at its scan budget, so a title-only hit never walks a long body", () => {
    const filler = "plain filler words on a line\n";
    const long = `${filler.repeat(Math.ceil((4 * 1024 * 1024) / filler.length))}needle at the end\n`;
    const started = performance.now();
    expect(searchExcerpt(long, termsOf("needle"))).toBe("");
    expect(performance.now() - started).toBeLessThan(250);

    const early = `${filler.repeat(Math.floor(SEARCH_EXCERPT_SCAN_CHARS / 2 / filler.length))}needle here\n`;
    expect(searchExcerpt(early, termsOf("needle"))).toBe("needle here");
  });

  it("bounds a single line longer than the budget too", () => {
    const line = `${"word ".repeat(SEARCH_EXCERPT_SCAN_CHARS)}needle`;
    expect(searchExcerpt(line, termsOf("needle"))).toBe("");
  });
});
