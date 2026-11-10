import { fakeClock } from "@repo/contract/test-support/fake-clock";
import { describe, expect, it } from "vitest";
import { leaveAsks, SETTLE_ANSWER_MS } from "./leave-asks";

const asksOver = () => {
  const clock = fakeClock();
  const counts: number[] = [];
  const asks = leaveAsks({
    asked: (count) => {
      counts.push(count);
    },
    clock,
  });
  const heard: boolean[] = [];
  const ask = (): void => {
    asks.ask((holds) => {
      heard.push(holds);
    });
  };
  return { asks, ask, clock, counts, heard };
};

describe("a leave's ask of the note page", () => {
  it("hands the page each ask as the next count, and hears its answer once", () => {
    const { asks, ask, clock, counts, heard } = asksOver();
    ask();
    expect(counts).toStrictEqual([1]);
    asks.answer({ ask: 1, holds: true });
    asks.answer({ ask: 1, holds: false });
    clock.advance(SETTLE_ANSWER_MS);
    expect(heard).toStrictEqual([true]);
    expect(clock.pending()).toBe(0);
  });

  it("counts a page that does not answer in time as not holding", () => {
    const { asks, ask, clock, heard } = asksOver();
    ask();
    clock.advance(SETTLE_ANSWER_MS - 1);
    expect(heard).toStrictEqual([]);
    clock.advance(1);
    expect(heard).toStrictEqual([false]);
    asks.answer({ ask: 1, holds: true });
    expect(heard).toStrictEqual([false]);
  });

  it("settles each ask by its own count", () => {
    const { asks, ask, counts, heard } = asksOver();
    ask();
    ask();
    expect(counts).toStrictEqual([1, 2]);
    asks.answer({ ask: 2, holds: false });
    asks.answer({ ask: 3, holds: true });
    asks.answer({ ask: 1, holds: true });
    expect(heard).toStrictEqual([false, true]);
  });
});
