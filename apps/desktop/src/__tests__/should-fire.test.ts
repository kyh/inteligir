import { describe, it, expect } from "vitest";
import { shouldFire } from "@/main/tasks/task-manager";
import type { Task } from "@/shared/task";

function makeTask(overrides?: Partial<Task>): Task {
  return {
    id: "t1",
    label: "Test",
    prompt: "do something",
    schedule: { type: "once", runAt: 1000 },
    enabled: true,
    lastRunAt: null,
    createdAt: 500,
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Cron schedule
// ---------------------------------------------------------------------------

describe("shouldFire — cron", () => {
  it("fires when next cron run is in the past", () => {
    // "* * * * *" = every minute; lastRunAt 2 minutes ago → next run was 1 min ago
    const twoMinAgo = Date.now() - 120_000;
    const task = makeTask({
      schedule: { type: "cron", cron: "* * * * *" },
      lastRunAt: twoMinAgo,
      createdAt: twoMinAgo - 60_000,
    });
    expect(shouldFire(task, Date.now())).toBe(true);
  });

  it("does NOT fire when next cron run is in the future", () => {
    // lastRunAt = just now → next run is ~1 min from now
    const now = Date.now();
    const task = makeTask({
      schedule: { type: "cron", cron: "* * * * *" },
      lastRunAt: now,
      createdAt: now - 60_000,
    });
    expect(shouldFire(task, now)).toBe(false);
  });

  it("uses lastRunAt as reference time, not createdAt", () => {
    // createdAt long ago, but lastRunAt is recent → should not fire yet
    const now = Date.now();
    const task = makeTask({
      schedule: { type: "cron", cron: "* * * * *" },
      createdAt: now - 600_000,
      lastRunAt: now,
    });
    expect(shouldFire(task, now)).toBe(false);
  });

  it("falls back to createdAt when lastRunAt is null", () => {
    // createdAt 2 minutes ago, never run → next cron run is in the past
    const twoMinAgo = Date.now() - 120_000;
    const task = makeTask({
      schedule: { type: "cron", cron: "* * * * *" },
      createdAt: twoMinAgo,
      lastRunAt: null,
    });
    expect(shouldFire(task, Date.now())).toBe(true);
  });

  it("returns false for invalid cron expression (no throw)", () => {
    const task = makeTask({
      schedule: { type: "cron", cron: "not-valid-cron" },
    });
    expect(shouldFire(task, Date.now())).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Interval schedule
// ---------------------------------------------------------------------------

describe("shouldFire — interval", () => {
  it("fires immediately when lastRunAt is null", () => {
    const task = makeTask({
      schedule: { type: "interval", intervalMs: 60_000 },
      lastRunAt: null,
    });
    expect(shouldFire(task, Date.now())).toBe(true);
  });

  it("fires when now - lastRunAt >= intervalMs", () => {
    const task = makeTask({
      schedule: { type: "interval", intervalMs: 60_000 },
      lastRunAt: 1000,
    });
    expect(shouldFire(task, 61_000)).toBe(true);
    // exactly at boundary
    expect(shouldFire(task, 61_000)).toBe(true);
  });

  it("does NOT fire when interval has not elapsed", () => {
    const task = makeTask({
      schedule: { type: "interval", intervalMs: 60_000 },
      lastRunAt: 1000,
    });
    expect(shouldFire(task, 30_000)).toBe(false);
    expect(shouldFire(task, 60_999)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Once schedule
// ---------------------------------------------------------------------------

describe("shouldFire — once", () => {
  it("fires when now >= runAt and never run", () => {
    const task = makeTask({
      schedule: { type: "once", runAt: 1000 },
      lastRunAt: null,
    });
    expect(shouldFire(task, 1000)).toBe(true);
    expect(shouldFire(task, 2000)).toBe(true);
  });

  it("does NOT fire before runAt", () => {
    const task = makeTask({
      schedule: { type: "once", runAt: 1000 },
      lastRunAt: null,
    });
    expect(shouldFire(task, 999)).toBe(false);
  });

  it("does NOT fire if already run (lastRunAt is set)", () => {
    const task = makeTask({
      schedule: { type: "once", runAt: 1000 },
      lastRunAt: 1000,
    });
    expect(shouldFire(task, 2000)).toBe(false);
  });
});
