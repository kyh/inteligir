import { describe, expect, it, vi } from "vitest";

// daily-refresh imports the task manager (huge transitive graph); stub it so
// we can import and exercise the pure helpers in isolation. The machine
// accessors are injected deps now, so no app-machine mock is needed.
vi.mock("@/main/tasks/task-manager", () => ({ getTaskManager: vi.fn() }));

import {
  DAILY_REFRESH_STORE_OPTIONS,
  DailyRefreshFileSchema,
  RECENT_ACTIVITY_WINDOW_MS,
  buildGreetingPrompt,
  dayKey,
  isRecentlyActive,
  isRefreshDue,
  refreshSince,
} from "@/main/daily-refresh";
import { JsonStore, type FsAdapter } from "@/main/lib/json-store";
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

  it("isRecentlyActive guards an in-use thread, but not a never-used or idle one", () => {
    const now = new Date(2026, 5, 6, 0, 1); // 12:01am — just past midnight
    // Never interacted: not recent.
    expect(isRecentlyActive(null, now)).toBe(false);
    // Last turn 3 minutes ago (the 11:58pm conversation): recent — don't roll.
    expect(isRecentlyActive(now.getTime() - 3 * 60 * 1000, now)).toBe(true);
    // Exactly at the window boundary: no longer recent.
    expect(isRecentlyActive(now.getTime() - RECENT_ACTIVITY_WINDOW_MS, now)).toBe(false);
    // Well past the window: not recent.
    expect(isRecentlyActive(now.getTime() - RECENT_ACTIVITY_WINDOW_MS - 1, now)).toBe(false);
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

// ---------------------------------------------------------------------------
// daily-refresh.json store format — versioned wire format with legacy upgrade
// ---------------------------------------------------------------------------

function memoryFs(seed: Record<string, unknown> = {}): FsAdapter & { files: Map<string, string> } {
  const files = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) files.set(k, JSON.stringify(v));
  return {
    files,
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      files.set(path, content);
    },
    rename: (from, to) => {
      const content = files.get(from);
      if (content === undefined) throw new Error(`rename: missing ${from}`);
      files.delete(from);
      files.set(to, content);
    },
  };
}

const STORE_PATH = "/daily-refresh.json";

function makeStore(fs: FsAdapter) {
  return new JsonStore(
    STORE_PATH,
    DailyRefreshFileSchema,
    DAILY_REFRESH_STORE_OPTIONS.defaultValue,
    {
      fs,
      versioning: DAILY_REFRESH_STORE_OPTIONS.versioning,
      decode: DAILY_REFRESH_STORE_OPTIONS.decode,
      encode: DAILY_REFRESH_STORE_OPTIONS.encode,
    },
  );
}

describe("daily-refresh store format", () => {
  it("persists the versioned wire format", () => {
    const fs = memoryFs();
    const store = makeStore(fs);
    store.write({ lastRefreshDay: "2026-06-09", lastRefreshAt: 123, enabled: true });

    expect(JSON.parse(fs.files.get(STORE_PATH) ?? "")).toEqual({
      version: 1,
      lastRefreshDay: "2026-06-09",
      lastRefreshAt: 123,
      enabled: true,
    });
  });

  it("migrates a legacy bare-state file and rewrites it versioned", () => {
    const legacy = { lastRefreshDay: "2026-06-08", lastRefreshAt: 99, enabled: false };
    const fs = memoryFs({ [STORE_PATH]: legacy });
    const store = makeStore(fs);

    expect(store.read()).toEqual(legacy);
    expect(JSON.parse(fs.files.get(STORE_PATH) ?? "")).toEqual({ version: 1, ...legacy });
  });

  it("quarantines an unrecognizable legacy file and resets to defaults", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const fs = memoryFs({ [STORE_PATH]: "not-an-object" });
      const store = makeStore(fs);

      expect(store.read()).toEqual(DAILY_REFRESH_STORE_OPTIONS.defaultValue);
      expect([...fs.files.keys()].some((k) => k.startsWith(`${STORE_PATH}.corrupt-`))).toBe(true);
    } finally {
      errorSpy.mockRestore();
    }
  });
});
