import { describe, expect, it, vi } from "vitest";

import { mdastOf } from "../../test-support/mdast-of";

const LONG_LINES = 4000;
const SHORT_LINES = LONG_LINES / 8;
// steps counted rather than milliseconds timed, so no runner's load can move it: linear, eight
// times the lines costs about 8x; with micromark merging a paragraph's text by one splice per line
// (patches/micromark@4.0.3.patch undoes that), about 64x
const GROWTH_CEILING = 20;

const paragraph = (lines: number): string => "Entry about quokkas.\n".repeat(lines);

// what the parse's splices cost: a step for each call and one for each element it moves to close or
// open its gap, which a splice per line makes quadratic in the lines
const spliceSteps = (content: string): number => {
  const { splice } = Array.prototype;
  let steps = 0;
  const counted = vi.spyOn(Array.prototype, "splice").mockImplementation(function countSteps(
    this: unknown[],
    ...args
  ) {
    const before = this.length;
    const removed = splice.apply(this, args);
    const [start] = args;
    const at = start < 0 ? Math.max(before + start, 0) : Math.min(start, before);
    const inserted = Math.max(args.length - 2, 0);
    steps += 1 + (this.length === before ? 0 : this.length - at - inserted);
    return removed;
  });
  try {
    mdastOf(content);
  } finally {
    counted.mockRestore();
  }
  return steps;
};

describe("parsing one long paragraph", () => {
  it("costs steps linear in its lines", () => {
    const growth = spliceSteps(paragraph(LONG_LINES)) / spliceSteps(paragraph(SHORT_LINES));
    expect(growth).toBeLessThan(GROWTH_CEILING);
  });
});
