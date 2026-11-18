import { describe, expect, it, vi } from "vitest";

import { mdastOf } from "../../test-support/mdast-of.test-utils";

const LONG_LINES = 4000;
const SHORT_LINES = LONG_LINES / 8;
const GROWTH_CEILING = 20;

const paragraph = (lines: number) => "Entry about quokkas.\n".repeat(lines);

const spliceSteps = (content: string) => {
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
