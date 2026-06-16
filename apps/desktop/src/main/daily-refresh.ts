// ---------------------------------------------------------------------------
// Daily refresh — once per local day, when the user opens the app, start a
// fresh user-facing session and greet them with a summary of what the
// background task agent did overnight.
//
// The summary is built from the TaskRunLog (the durable record of background
// runs), not from the background agent's session memory, so it survives
// restarts. `maybeDailyRefresh()` is the orchestrator; app-machine wires it
// to the ready phase and the window-focus trigger via maybeRunDailyRefresh().
// The machine accessors arrive as injected deps (app-machine imports this
// module, never the reverse) so the dependency stays one-way. The pure
// helpers are exported for unit testing.
// ---------------------------------------------------------------------------

import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { JsonStore, inteligirPath, type StoreVersioning } from "@/main/lib/json-store";
import { getTaskManager } from "@/main/tasks/task-manager";
import type { AppState } from "@/shared/app-state";
import { isRecord } from "@/shared/ipc";
import type { Task, TaskRunLog } from "@/shared/task";

/** Machine accessors injected by app-machine (the module that owns them). */
export type DailyRefreshDeps = {
  getAppState: () => AppState;
  /** Roll the user session and submit the greeting turn (app-machine.dailyRefresh). */
  dailyRefresh: (buildGreeting: () => string) => Promise<{ ok: boolean; skipped?: string }>;
  /** Epoch ms of the most recent user-facing agent activity, or null. */
  getLastUserActivityAt: () => number | null;
};

const DAILY_REFRESH_VERSION = 1;

/** Versioned on-disk shape of ~/.inteligir/daily-refresh.json. Exported (with
 * the versioning/codec below) for the store-roundtrip unit tests. */
export const DailyRefreshFileSchema = Type.Object(
  {
    version: Type.Literal(DAILY_REFRESH_VERSION),
    /** Local YYYY-MM-DD of the last refresh; gates one refresh per day. */
    lastRefreshDay: Type.Union([Type.String(), Type.Null()]),
    /** Epoch ms of the last refresh; the window the next summary covers. */
    lastRefreshAt: Type.Union([Type.Number(), Type.Null()]),
    /** Opt-out switch (default on). */
    enabled: Type.Boolean(),
  },
  { additionalProperties: false },
);
type State = { lastRefreshDay: string | null; lastRefreshAt: number | null; enabled: boolean };

const DEFAULT: State = { lastRefreshDay: null, lastRefreshAt: null, enabled: true };

export const DAILY_REFRESH_STORE_OPTIONS: {
  defaultValue: State;
  versioning: StoreVersioning;
  decode: (raw: unknown) => State;
  encode: (state: State) => unknown;
} = {
  defaultValue: DEFAULT,
  versioning: {
    current: DAILY_REFRESH_VERSION,
    // daily-refresh.json began life as the bare flat state — stamp a version.
    fromLegacy: (raw) => (isRecord(raw) ? { ...raw, version: DAILY_REFRESH_VERSION } : raw),
  },
  // Re-check purely to narrow the type — JsonStore validated before decode.
  decode: (raw) => {
    if (!Value.Check(DailyRefreshFileSchema, raw)) {
      throw new Error("daily-refresh file shape rejected");
    }
    return {
      lastRefreshDay: raw.lastRefreshDay,
      lastRefreshAt: raw.lastRefreshAt,
      enabled: raw.enabled,
    };
  },
  encode: (state) => ({ version: DAILY_REFRESH_VERSION, ...state }),
};

let store: JsonStore<State> | null = null;
function getStore(): JsonStore<State> {
  if (!store) {
    store = new JsonStore<State>(
      inteligirPath("daily-refresh.json"),
      DailyRefreshFileSchema,
      DAILY_REFRESH_STORE_OPTIONS.defaultValue,
      {
        versioning: DAILY_REFRESH_STORE_OPTIONS.versioning,
        decode: DAILY_REFRESH_STORE_OPTIONS.decode,
        encode: DAILY_REFRESH_STORE_OPTIONS.encode,
      },
    );
  }
  return store;
}

/** Reset the cached store. Called from teardownAgentResources() after
 * AGENT_DIR is wiped so a re-login doesn't serve a stale lastRefreshDay. */
export function resetDailyRefresh(): void {
  store = null;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RUNS_IN_SUMMARY = 30;

/** A refresh replaces the whole user thread, so it must not fire while the
 * user is actively conversing (e.g. a session straddling midnight): defer
 * until this much time has passed since the last user-facing agent turn. */
export const RECENT_ACTIVITY_WINDOW_MS = 30 * 60 * 1000;

/** True when user-facing agent activity happened inside the recency window.
 * The busy check in app-machine only protects mid-turn; this protects
 * mid-conversation. */
export function isRecentlyActive(lastUserActivityAt: number | null, now: Date): boolean {
  return (
    lastUserActivityAt !== null && now.getTime() - lastUserActivityAt < RECENT_ACTIVITY_WINDOW_MS
  );
}

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
export function buildGreetingPrompt(
  runs: TaskRunLog[],
  tasksById: Map<string, string>,
  now: Date,
): string {
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
    const detail =
      r.status === "failed" ? (r.error ?? "failed") : (r.resultSummary ?? "(no output)");
    return `- ${label} — ${r.status} (${secs}): ${detail}`;
  });

  return (
    `Good morning — it's ${dateStr}. While you were away I ran ${runs.length} background ` +
    `task${runs.length === 1 ? "" : "s"}. Greet me briefly and summarize what happened in a ` +
    `few sentences, calling out anything that failed or needs my attention. Don't just repeat ` +
    `the list verbatim.\n\nRuns:\n${lines.join("\n")}`
  );
}

let refreshInFlight: Promise<void> | null = null;

/**
 * If a refresh is due and the app is ready, start a fresh session and greet the
 * user with the overnight summary. Safe to call on every window focus AND the
 * ready-state hook — single-flighted via `refreshInFlight` so the two triggers
 * can't roll the session twice, and a no-op when not due, disabled, or not
 * ready. `lastRefreshDay` is only advanced on a successful refresh, so a
 * deferral (busy/not-ready) retries on the next trigger.
 */
export function maybeDailyRefresh(deps: DailyRefreshDeps): Promise<void> {
  // Collapse concurrent callers onto one run. The body's due-checks are
  // synchronous (so the very next caller already sees this promise), and this
  // also stays correct if an await is ever introduced before the work begins.
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = runRefresh(deps).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function runRefresh(deps: DailyRefreshDeps): Promise<void> {
  const state = getStore().read();
  if (!state.enabled) return;

  const now = new Date();
  if (!isRefreshDue(state.lastRefreshDay, now)) return;

  // Need a live, set-up user agent to refresh into.
  if (deps.getAppState().phase !== "ready") return;

  // Don't roll a thread the user is actively in: the day-key gate keeps the
  // refresh "due" until it succeeds, so a between-turns refocus during a
  // late-night conversation would otherwise replace it. The day stays
  // unspent — a later trigger retries once the user has been idle.
  if (isRecentlyActive(deps.getLastUserActivityAt(), now)) {
    console.log("[daily-refresh] skipped: recent-activity");
    return;
  }

  const since = refreshSince(state.lastRefreshAt, now);
  const tm = getTaskManager();
  const runs = tm.getRunsSince(since);
  const tasksById = new Map<string, string>(tm.getTasks().map((t: Task) => [t.id, t.label]));

  const result = await deps.dailyRefresh(() => buildGreetingPrompt(runs, tasksById, new Date()));
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
}
