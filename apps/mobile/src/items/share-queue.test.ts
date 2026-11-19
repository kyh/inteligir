import { describe, expect, it, vi } from "vitest";

import { deferred } from "@repo/contract/deferred";
import { nextTask } from "../test-support/async.test-utils";
import { createShareQueue } from "./share-queue";

const pending = () => {
  const ends: (() => void)[] = [];
  const events: string[] = [];

  const ports = {
    reset: () => {
      events.push("reset");
    },
    settle: async (intent: string) => {
      events.push(`settle ${intent}`);
      // oxlint-disable-next-line promise/avoid-new -- a settle the test ends by hand, which only a promise's resolve can do
      await new Promise<void>((resolve) => {
        ends.push(resolve);
      });
      events.push(`settled ${intent}`);

      return "settled" as const;
    },
  };

  const end = (index: number) => {
    ends[index]?.();
  };

  return { end, events, ports };
};

const resetting = () => {
  const heard = deferred();
  let count = 0;

  return {
    count: () => count,
    first: heard.promise,
    reset: () => {
      count += 1;
      heard.resolve();
    },
  };
};

describe("the shares the inbox settles", () => {
  it("settles a share made while another settles, and lets the context go once, after it", async () => {
    const { end, events, ports } = pending();
    const queue = createShareQueue<string>();
    queue.offer("first", ports);
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

  it("keeps a share its library left under it, for the screen the next sign-in mounts", async () => {
    const resets = resetting();
    const { reset } = resets;
    const settled: string[] = [];
    const queue = createShareQueue<string>();
    queue.offer("only", {
      reset,
      settle: async () => await Promise.resolve("held"),
    });
    await nextTask();
    expect(resets.count()).toBe(0);

    queue.offer("only", {
      reset,
      settle: async (intent) => {
        settled.push(intent);

        return await Promise.resolve("settled");
      },
    });
    await resets.first;
    expect(resets.count()).toBe(1);
    expect(settled).toStrictEqual(["only"]);
  });

  it("settles a held share through the library a failed sign-out opened again meanwhile", async () => {
    const resets = resetting();
    const { reset } = resets;
    const left = deferred<"held">();
    const settled: string[] = [];
    const queue = createShareQueue<string>();
    queue.offer("only", { reset, settle: async () => await left.promise });
    queue.offer("only", {
      reset,
      settle: async (intent) => {
        settled.push(intent);

        return await Promise.resolve("settled");
      },
    });

    left.resolve("held");
    await resets.first;
    expect(resets.count()).toBe(1);
    expect(settled).toStrictEqual(["only"]);
  });
});
