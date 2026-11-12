import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { keepSession, SESSION_READ_MS } from "./auth-client";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("keeping a tab's session", () => {
  it("reads it inside the day a session waits to slide, and keeps reading", async () => {
    const read = vi.fn<() => Promise<void>>(async () => {
      await Promise.resolve();
    });
    keepSession(read);
    expect(read).not.toHaveBeenCalled();
    expect(SESSION_READ_MS).toBeLessThan(86_400_000);

    await vi.advanceTimersByTimeAsync(2 * SESSION_READ_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it("reads again after a read that found no network", async () => {
    const read = vi.fn<() => Promise<void>>(async () => {
      await Promise.reject(new TypeError("Failed to fetch"));
    });
    keepSession(read);

    await vi.advanceTimersByTimeAsync(2 * SESSION_READ_MS);
    expect(read).toHaveBeenCalledTimes(2);
  });
});
