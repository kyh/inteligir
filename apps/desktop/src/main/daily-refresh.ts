// ---------------------------------------------------------------------------
// Daily refresh — once per local day, when the user opens the app, start a
// fresh user-facing session and greet them with a summary of what the
// background task agent did overnight.
//
// The summary is built from the TaskRunLog (the durable record of background
// runs), not from the background agent's session memory, so it survives
// restarts. `maybeDailyRefresh()` is the orchestrator wired to window focus in
// index.ts; the pure helpers are exported for unit testing.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";

import { dailyRefresh, getAppState } from "@/main/app-machine";
import { JsonStore, inteligirPath } from "@/main/lib/json-store";
import { getTaskManager } from "@/main/tasks/task-manager";
import type { Task, TaskRunLog } from "@/shared/task";

const StateSchema = Type.Object({
  /** Local YYYY-MM-DD of the last refresh; gates one refresh per day. */
  lastRefreshDay: Type.Union([Type.String(), Type.Null()]),
  /** Epoch ms of the last refresh; the window the next summary covers. */
  lastRefreshAt: Type.Union([Type.Number(), Type.Null()]),
  /** Opt-out switch (default on). */
  enabled: Type.Boolean(),
});
type State = { lastRefreshDay: string | null; lastRefreshAt: number | null; enabled: boolean };

const DEFAULT: State = { lastRefreshDay: null, lastRefreshAt: null, enabled: true };

let store: JsonStore<State> | null = null;
function getStore(): JsonStore<State> {
  if (!store) store = new JsonStore<State>(inteligirPath("daily-refresh.json"), StateSchema, DEFAULT);
  return store;
}

/** Reset the cached store. Called from teardownResources() after AGENT_DIR is
 * wiped so a re-login doesn't serve a stale lastRefreshDay. */
export function resetDailyRefresh(): void {
  store = null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS_IN_SUMMARY = 30;

/** Local calendar day key, e.g. "2026-06-06". */
export function dayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** A refresh is due the first time the app is opened on a new local day. */
export function isRefreshDue(lastRefreshDay: string | null, now: Date): boolean {
  return dayKey(now) !== lastRefreshDay;
}

/** Start of the window the next summary covers: the last refresh, or ~24h ago
 * the first time. */
export function refreshSince(lastRefreshAt: number | null, now: Date): number {
  return lastRefreshAt ?? now.getTime() - DAY_MS;
}

/** Build the first-turn prompt that asks the agent to greet the user and
 * summarize overnight runs. `runs` is oldest-first; `tasksById` maps task id to
 * its label for readable lines. */
export function buildGreetingPrompt(runs: TaskRunLog[], tasksById: Map<string, string>, now: Date): string {
  const dateStr = now.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  if (runs.length === 0) {
    return (
      `Good morning — it's ${dateStr}. No background tasks ran while I was away. ` +
      `Greet me briefly by name if you know it, and ask what I'd like to work on.`
    );
  }

  const shown = runs.slice(-MAX_RUNS_IN_SUMMARY);
  const lines = shown.map((r) => {
    const label = tasksById.get(r.taskId) ?? "task";
    const secs = r.durationMs != null ? `${Math.round(r.durationMs / 1000)}s` : "—";
    const detail = r.status === "failed" ? (r.error ?? "failed") : (r.resultSummary ?? "(no output)");
    return `- ${label} — ${r.status} (${secs}): ${detail}`;
  });

  return (
    `Good morning — it's ${dateStr}. While you were away I ran ${runs.length} background ` +
    `task${runs.length === 1 ? "" : "s"}. Greet me briefly and summarize what happened in a ` +
    `few sentences, calling out anything that failed or needs my attention. Don't just repeat ` +
    `the list verbatim.\n\nRuns:\n${lines.join("\n")}`
  );
}

let inFlight = false;

/**
 * If a refresh is due and the app is ready, start a fresh session and greet the
 * user with the overnight summary. Safe to call on every window focus — it's a
 * no-op when not due, disabled, not ready, or already running. `lastRefreshDay`
 * is only advanced on a successful refresh, so a deferral (busy/not-ready)
 * retries on the next focus.
 */
export async function maybeDailyRefresh(): Promise<void> {
  if (inFlight) return;

  const state = getStore().read();
  if (!state.enabled) return;

  const now = new Date();
  if (!isRefreshDue(state.lastRefreshDay, now)) return;

  // Need a live, set-up user agent to refresh into.
  if (getAppState().phase !== "ready") return;

  inFlight = true;
  try {
    const since = refreshSince(state.lastRefreshAt, now);
    const tm = getTaskManager();
    const runs = tm.getRunsSince(since);
    const tasksById = new Map<string, string>(tm.getTasks().map((t: Task) => [t.id, t.label]));

    const result = await dailyRefresh(() => buildGreetingPrompt(runs, tasksById, new Date()));
    if (result.ok) {
      const done = new Date();
      getStore().update(() => ({
        lastRefreshDay: dayKey(done),
        lastRefreshAt: done.getTime(),
        enabled: state.enabled,
      }));
    } else {
      console.log(`[daily-refresh] skipped: ${result.skipped ?? "unknown"}`);
    }
  } finally {
    inFlight = false;
  }
}
