import { describe, expect, it } from "vitest";

import { projectDoc } from "../knowledge/projection";

const LONG_LINES = 20_000;
const SHORT_LINES = LONG_LINES / 8;
// a ratio rather than a wall-clock ceiling, so a slow or loaded runner cannot fail it: linear, eight
// times the lines costs 7.5x (0.36s against 0.05s); with micromark merging a paragraph's text
// by one splice per line (patches/micromark@4.0.2.patch undoes that), 30-70x (3.9s)
const GROWTH_CEILING = 16;

const paragraph = (lines: number): string => "Entry about quokkas.\n".repeat(lines);

// the fastest of three, so one GC pause or scheduler stall cannot stand for the cost
const fastestProjectionMs = (content: string): number => {
  let fastest = Number.POSITIVE_INFINITY;
  for (let run = 0; run < 3; run += 1) {
    const began = performance.now();
    projectDoc("field-notes.md", content);
    fastest = Math.min(fastest, performance.now() - began);
  }
  return fastest;
};

describe("projecting one long paragraph", () => {
  it("costs time linear in its lines", () => {
    const short = fastestProjectionMs(paragraph(SHORT_LINES));
    const long = fastestProjectionMs(paragraph(LONG_LINES));
    expect(long / short).toBeLessThan(GROWTH_CEILING);
  });
});
