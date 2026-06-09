import { describe, expect, it, vi } from "vitest";

// daily-refresh transitively imports app-machine (huge graph) and the task
// manager; stub both so we can import and exercise the pure helpers in
// isolation. The helpers under test don't touch either mock.
vi.mock("@/main/app-machine", () => ({
  dailyRefresh: vi.fn(),
  getAppState: () => ({ phase: "ready" }),
}));
vi.mock("@/main/tasks/task-manager", () => ({ getTaskManager: vi.fn() }));

import { buildGreetingPrompt, dayKey, isRefreshDue, refreshSince } from "@/main/daily-refresh";
import type { TaskRunLog } from "@/shared/task";

function run(over: Partial<TaskRunLog>): TaskRunLog {
  return {
    id: crypto.randomUUID(),
    taskId: "t1",
    startedAt: 1000,
    durationMs: 2000,
    status: "completed",
    error: null,
    resultSummary: "did the thing",
    ...over,
  };
}

describe("daily-refresh helpers", () => {
  it("dayKey is the local calendar day", () => {
    expect(dayKey(new Date(2026, 5, 6, 9, 30))).toBe("2026-06-06");
    expect(dayKey(new Date(2026, 0, 1, 0, 0))).toBe("2026-01-01");
  });

  it("isRefreshDue is true on a new local day, null, never on the same day", () => {
    const now = new Date(2026, 5, 6, 8, 0);
    expect(isRefreshDue(null, now)).toBe(true);
    expect(isRefreshDue("2026-06-05", now)).toBe(true);
    expect(isRefreshDue("2026-06-06", now)).toBe(false);
  });

  it("refreshSince returns the last refresh, or ~24h ago when never refreshed", () => {
    const now = new Date(2026, 5, 6, 8, 0);
    expect(refreshSince(12345, now)).toBe(12345);
    expect(refreshSince(null, now)).toBe(now.getTime() - 24 * 60 * 60 * 1000);
  });

  it("buildGreetingPrompt summarizes runs with label, status and detail", () => {
    const now = new Date(2026, 5, 6, 8, 0);
    const tasksById = new Map([
      ["t1", "Morning digest"],
      ["t2", "Backup"],
    ]);
    const runs = [
      run({ taskId: "t1", status: "completed", resultSummary: "5 new emails" }),
      run({ taskId: "t2", status: "failed", error: "disk full", resultSummary: null }),
    ];
    const prompt = buildGreetingPrompt(runs, tasksById, now);
    expect(prompt).toContain("ran 2 background tasks");
    expect(prompt).toContain("Morning digest — completed");
    expect(prompt).toContain("5 new emails");
    expect(prompt).toContain("Backup — failed");
    expect(prompt).toContain("disk full");
  });

  it("buildGreetingPrompt has a distinct empty-overnight variant", () => {
    const prompt = buildGreetingPrompt([], new Map(), new Date(2026, 5, 6, 8, 0));
    expect(prompt).toContain("No background tasks ran");
    expect(prompt).not.toContain("Runs:");
  });

  it("buildGreetingPrompt caps the run list but still reports the true count", () => {
    const tasksById = new Map([["t1", "Ping"]]);
    const runs = Array.from({ length: 40 }, (_, i) => run({ taskId: "t1", startedAt: i }));
    const prompt = buildGreetingPrompt(runs, tasksById, new Date(2026, 5, 6, 8, 0));
    expect(prompt).toContain("ran 40 background tasks");
    expect(prompt.match(/Ping — completed/g)?.length).toBe(30);
  });
});
