import type { Clock } from "@repo/contract/cloud/library/account-socket";
import { describe, expect, it, vi } from "vitest";

import { keepSession, SESSION_READ_MS } from "./session-keeper";

// a clock the test runs by hand: `tick` fires whatever is waiting, as that much time passing would
const handClock = () => {
  let waiting: { readonly ms: number; readonly run: () => void }[] = [];
  const clock: Clock = {
    after: (ms, run) => {
      waiting.push({ ms, run });
      return () => {};
    },
    now: () => 0,
  };
  const tick = (): void => {
    const due = waiting;
    waiting = [];
    for (const { run } of due) {
      run();
    }
  };
  return { clock, tick, waits: () => waiting.map(({ ms }) => ms) };
};

describe("keeping a tab's session", () => {
  it("reads it inside the day a session waits to slide, and keeps reading", () => {
    const { clock, tick, waits } = handClock();
    const read = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    keepSession(clock, read);
    expect(read).not.toHaveBeenCalled();
    expect(SESSION_READ_MS).toBeLessThan(86_400_000);
    expect(waits()).toStrictEqual([SESSION_READ_MS]);

    tick();
    tick();
    expect(read).toHaveBeenCalledTimes(2);
    expect(waits()).toStrictEqual([SESSION_READ_MS]);
  });

  it("reads again after a read that found no network", async () => {
    const { clock, tick, waits } = handClock();
    const read = vi.fn<() => Promise<void>>(async () => {
      await Promise.reject(new TypeError("Failed to fetch"));
    });
    keepSession(clock, read);

    tick();
    await expect(read.mock.results[0]?.value).rejects.toThrow("Failed to fetch");
    expect(waits()).toStrictEqual([SESSION_READ_MS]);
  });
});
