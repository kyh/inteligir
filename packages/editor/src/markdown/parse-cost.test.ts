import { describe, expect, it } from "vitest";

import { mdastOf } from "../test-support/mdast-of";

const LONG_LINES = 20_000;
const SHORT_LINES = LONG_LINES / 8;
// a ratio rather than a wall-clock ceiling, so a slow or loaded runner cannot fail it: linear, eight
// times the lines costs about 8x; with micromark merging a paragraph's text by one splice per line
// (patches/micromark@4.0.3.patch undoes that), 30-70x
const GROWTH_CEILING = 20;
const ROUNDS = 5;

const paragraph = (lines: number): string => "Entry about quokkas.\n".repeat(lines);

const parseMs = (content: string): number => {
  const began = performance.now();
  mdastOf(content);
  return performance.now() - began;
};

// the sizes alternate, so a stretch of contention on a shared runner lands on both rather than
// one; the fastest of each, so one GC pause or scheduler stall cannot stand for the cost
const growth = (): number => {
  const short = paragraph(SHORT_LINES);
  const long = paragraph(LONG_LINES);
  parseMs(short);
  let fastestShort = Number.POSITIVE_INFINITY;
  let fastestLong = Number.POSITIVE_INFINITY;
  for (let round = 0; round < ROUNDS; round += 1) {
    fastestShort = Math.min(fastestShort, parseMs(short));
    fastestLong = Math.min(fastestLong, parseMs(long));
  }
  return fastestLong / fastestShort;
};

describe("parsing one long paragraph", () => {
  // a 20,000-line paragraph, five times, on purpose: the cost is the claim
  it("costs time linear in its lines", { timeout: 120_000 }, () => {
    expect(growth()).toBeLessThan(GROWTH_CEILING);
  });
});
