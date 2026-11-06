import { describe, expect, it, vi } from "vitest";

import { createShareQueue } from "./share-queue";

// a settle the test ends when it chooses, as a page read that takes its time
const pending = () => {
  const ends: (() => void)[] = [];
  const events: string[] = [];
  const ports = {
    reset: () => {
      events.push("reset");
    },
    settle: async (intent: string): Promise<void> => {
      events.push(`settle ${intent}`);
      // oxlint-disable-next-line promise/avoid-new -- a settle the test ends by hand, which only a promise's resolve can do
      await new Promise<void>((resolve) => {
        ends.push(resolve);
      });
      events.push(`settled ${intent}`);
    },
  };
  const end = (index: number): void => {
    ends[index]?.();
  };
  return { end, events, ports };
};

describe("the shares the inbox settles", () => {
  it("settles a share made while another settles, and lets the context go once, after it", async () => {
    const { end, events, ports } = pending();
    const queue = createShareQueue<string>();
    queue.offer("first", ports);
    // the context replaces its intent with the second share while the first is read
    queue.offer("second", ports);
    end(0);
    await vi.waitFor(() => {
      expect(events).toStrictEqual(["settle first", "settled first", "settle second"]);
    });
    end(1);
    await vi.waitFor(() => {
      expect(events).toStrictEqual([
        "settle first",
        "settled first",
        "settle second",
        "settled second",
        "reset",
      ]);
    });
  });

  it("settles one share once, however often the screen offers it, and nothing for none", async () => {
    const { end, events, ports } = pending();
    const queue = createShareQueue<string>();
    queue.offer(null, ports);
    queue.offer("only", ports);
    queue.offer("only", ports);
    end(0);
    await vi.waitFor(() => {
      expect(events).toStrictEqual(["settle only", "settled only", "reset"]);
    });
    queue.offer(null, ports);
    expect(events).toStrictEqual(["settle only", "settled only", "reset"]);
  });
});
