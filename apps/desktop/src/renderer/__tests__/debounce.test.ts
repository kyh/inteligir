import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createDebouncer } from "@renderer/lib/debounce";

const DELAY_MS = 150;

describe("createDebouncer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("runs the serialize once after the debounce elapses", () => {
    const runs: number[] = [];
    const scheduler = createDebouncer(() => runs.push(Date.now()), DELAY_MS);

    scheduler.schedule();
    expect(runs).toHaveLength(0); // deferred — nothing ran synchronously

    vi.advanceTimersByTime(DELAY_MS - 1);
    expect(runs).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(runs).toHaveLength(1);
  });

  it("coalesces a burst of schedules into ONE serialize, timed from the last", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    // Three keystrokes 100ms apart — each resets the timer.
    scheduler.schedule();
    vi.advanceTimersByTime(100);
    scheduler.schedule();
    vi.advanceTimersByTime(100);
    scheduler.schedule();

    // The debounce counts from the LAST schedule.
    vi.advanceTimersByTime(DELAY_MS - 1);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);

    // Nothing left pending afterward.
    vi.advanceTimersByTime(DELAY_MS * 2);
    expect(runs).toBe(1);
  });

  it("flush() runs a pending serialize synchronously and clears the timer", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    scheduler.schedule();
    scheduler.flush();
    expect(runs).toBe(1); // ran NOW, not on the timer

    vi.advanceTimersByTime(DELAY_MS * 2);
    expect(runs).toBe(1); // the timer never fires a second run
  });

  it("flush() with nothing pending is a no-op", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    scheduler.flush();
    expect(runs).toBe(0);

    // Safe to call repeatedly from every save/close path.
    scheduler.flush();
    scheduler.flush();
    expect(runs).toBe(0);
  });

  it("flush() after the timer already fired is a no-op (no double serialize)", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    scheduler.schedule();
    vi.advanceTimersByTime(DELAY_MS);
    expect(runs).toBe(1);

    scheduler.flush();
    expect(runs).toBe(1);
  });

  it("cancel() drops a pending serialize without running it", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    scheduler.schedule();
    scheduler.cancel();
    vi.advanceTimersByTime(DELAY_MS * 2);
    expect(runs).toBe(0);

    // And a flush after cancel is a no-op too — the pending work is gone.
    scheduler.flush();
    expect(runs).toBe(0);
  });

  it("scheduling again after a fire starts a fresh debounce (freeze-lift settle propagates)", () => {
    // The freeze-lift path: the resolving edit fires onChange, which schedules
    // — a settle with no following keystroke must still serialize once.
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, DELAY_MS);

    scheduler.schedule();
    vi.advanceTimersByTime(DELAY_MS);
    expect(runs).toBe(1);

    scheduler.schedule();
    vi.advanceTimersByTime(DELAY_MS);
    expect(runs).toBe(2);
  });

  it("honors an injected delay", () => {
    let runs = 0;
    const scheduler = createDebouncer(() => runs++, 25);

    scheduler.schedule();
    vi.advanceTimersByTime(24);
    expect(runs).toBe(0);
    vi.advanceTimersByTime(1);
    expect(runs).toBe(1);
  });
});
