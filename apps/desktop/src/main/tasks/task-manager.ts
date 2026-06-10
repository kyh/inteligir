// ---------------------------------------------------------------------------
// TaskManager — unified task CRUD, scheduling, and run logging.
// Absorbs task-store, task-scheduler, and task-run-store into one deep module.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";
import { Cron } from "croner";

import type { Agent } from "@/agent/agent";
import { parseAgentEvent } from "@/shared/agent-event-parser";
import {
  TaskSchema,
  TaskRunLogSchema,
  type Task,
  type TaskRunLog,
  type CreateTaskParams,
} from "@/shared/task";
import { toErrorMessage } from "@/shared/ipc";
import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;
const TASK_TIMEOUT_MS = 5 * 60 * 1000;
const MAX_RUNS = 500;

// ---------------------------------------------------------------------------
// Store schemas — versioned wire format. The stores expose bare arrays in
// memory; on disk they are wrapped in `{ version, ... }` so schema changes
// can migrate instead of wiping (legacy files were bare arrays).
// ---------------------------------------------------------------------------

const TASKS_VERSION = 1;

const TasksFileSchema = Type.Object(
  { version: Type.Literal(TASKS_VERSION), tasks: Type.Array(TaskSchema) },
  { additionalProperties: false },
);
const RunsFileSchema = Type.Object(
  { version: Type.Literal(TASKS_VERSION), runs: Type.Array(TaskRunLogSchema) },
  { additionalProperties: false },
);

// ---------------------------------------------------------------------------
// Change notification — push channel for the Tasks panel.
//
// Registered from Electron-side composition (app-machine.initMachine wires it
// to broadcast("onTasksUpdated", …)) instead of imported, so this module stays
// electron-free and unit-testable — same seam as json-store's recovery
// notifier. Every task mutation (IPC, agent tool, or the scheduler marking a
// run) fans the fresh snapshot out to subscribed renderers.
// ---------------------------------------------------------------------------

let tasksChangedNotifier: ((tasks: Task[]) => void) | null = null;

export function setTasksChangedNotifier(notifier: ((tasks: Task[]) => void) | null): void {
  tasksChangedNotifier = notifier;
}

// ---------------------------------------------------------------------------
// TaskManager
// ---------------------------------------------------------------------------

export type TaskManagerOptions = {
  /** Override filesystem for testing */
  fs?: FsAdapter;
  /** Override paths for testing */
  tasksPath?: string;
  runsPath?: string;
};

export class TaskManager {
  private readonly tasks: JsonStore<Task[]>;
  private readonly runs: JsonStore<TaskRunLog[]>;

  // Scheduler state. The accessor returns the BACKGROUND agent (see
  // background-agent.ts), never the user-facing one — tasks run off the user
  // thread.
  private timer: ReturnType<typeof setInterval> | null = null;
  private firing = false;
  private getBackgroundAgent: (() => Agent | null) | null = null;

  constructor(opts?: TaskManagerOptions) {
    this.tasks = new JsonStore<Task[]>(
      opts?.tasksPath ?? inteligirPath("tasks.json"),
      TasksFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: TASKS_VERSION,
          // tasks.json began life as a bare Task[] — wrap it.
          fromLegacy: (raw) => ({ version: TASKS_VERSION, tasks: raw }),
        },
        // Re-check against the concrete schema purely to narrow the type —
        // JsonStore already validated before calling decode.
        decode: (raw) => {
          if (!Value.Check(TasksFileSchema, raw)) throw new Error("tasks file shape rejected");
          return raw.tasks;
        },
        encode: (tasks) => ({ version: TASKS_VERSION, tasks }),
      },
    );
    this.runs = new JsonStore<TaskRunLog[]>(
      opts?.runsPath ?? inteligirPath("task-runs.json"),
      RunsFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: TASKS_VERSION,
          // task-runs.json began life as a bare TaskRunLog[] — wrap it.
          fromLegacy: (raw) => ({ version: TASKS_VERSION, runs: raw }),
        },
        decode: (raw) => {
          if (!Value.Check(RunsFileSchema, raw)) throw new Error("runs file shape rejected");
          return raw.runs;
        },
        encode: (runs) => ({ version: TASKS_VERSION, runs }),
      },
    );
  }

  // ---- CRUD -----------------------------------------------------------------

  getTasks(): Task[] {
    return this.tasks.read();
  }

  /** Run-log entries that started at or after `sinceMs`, oldest first. Used by
   * the daily refresh to summarize what ran overnight. */
  getRunsSince(sinceMs: number): TaskRunLog[] {
    return this.runs.read().filter((r) => r.startedAt >= sinceMs);
  }

  createTask(params: CreateTaskParams): Task {
    const task: Task = {
      id: crypto.randomUUID(),
      label: params.label,
      prompt: params.prompt,
      schedule: params.schedule,
      enabled: true,
      lastRunAt: null,
      createdAt: Date.now(),
    };
    this.tasks.update((tasks) => [...tasks, task]);
    this.notifyTasksChanged();
    return task;
  }

  deleteTask(id: string): void {
    this.tasks.update((tasks) => tasks.filter((t) => t.id !== id));
    this.notifyTasksChanged();
  }

  toggleTask(id: string): Task {
    let toggled: Task | undefined;
    this.tasks.update((tasks) =>
      tasks.map((t) => {
        if (t.id !== id) return t;
        toggled = { ...t, enabled: !t.enabled };
        return toggled;
      }),
    );
    if (!toggled) throw new Error(`Task not found: ${id}`);
    this.notifyTasksChanged();
    return toggled;
  }

  /** Push the fresh snapshot to whoever registered (renderer broadcast). */
  private notifyTasksChanged(): void {
    try {
      tasksChangedNotifier?.(this.getTasks());
    } catch (err) {
      // Non-fatal: the panel falls back to its mount-time fetch.
      console.warn("[tasks] change notification failed:", err);
    }
  }

  // ---- Scheduler ------------------------------------------------------------

  startScheduler(getBackgroundAgent: () => Agent | null): void {
    if (this.timer) return;
    this.getBackgroundAgent = getBackgroundAgent;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.getBackgroundAgent = null;
  }

  private tick(): void {
    if (this.firing) return;
    const agent = this.getBackgroundAgent?.();
    if (!agent) return;

    // Serialize the background agent against itself (one task turn at a time);
    // combined with `firing` this is the only mutual exclusion needed, since
    // the background agent is dedicated to tasks and shares nothing with the
    // user session.
    const state = agent.getState();
    if (state.status === "busy") return;

    const now = Date.now();
    const tasks = this.getTasks();

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!shouldFire(task, now)) continue;
      void this.fireTask(agent, task, now);
      break; // one per tick
    }
  }

  private async fireTask(agent: Agent, task: Task, now: number): Promise<void> {
    this.firing = true;
    // `agent` here is the dedicated background agent, isolated from the user
    // session — so this turn neither blocks the user nor interleaves with chat
    // relays. Its assistant text is captured below for the run log (and later
    // the daily summary), not relayed anywhere live.

    // Mark the run in tasks file
    this.tasks.update((tasks) =>
      tasks.map((t) => {
        if (t.id !== task.id) return t;
        return {
          ...t,
          lastRunAt: now,
          ...(t.schedule.type === "once" ? { enabled: false } : {}),
        };
      }),
    );
    this.notifyTasksChanged();

    // Start a run log entry
    const run: TaskRunLog = {
      id: crypto.randomUUID(),
      taskId: task.id,
      startedAt: Date.now(),
      durationMs: null,
      status: "running",
      error: null,
      resultSummary: null,
    };
    this.runs.update((runs) => {
      const updated = [...runs, run];
      return updated.length > MAX_RUNS ? updated.slice(-MAX_RUNS) : updated;
    });

    // Capture THIS run's assistant text from the event stream rather than
    // getLastAssistantText() afterwards — that accessor returns the previous
    // turn's text after an early abort, which would log a stale result as
    // this run's summary. (Holder object: TS doesn't see closure assignments
    // to a plain `let` from the outer read.)
    const captured: { text: string | null } = { text: null };
    const unsubscribe = agent.subscribe((raw) => {
      const event = parseAgentEvent(raw);
      if (event?.type === "message_end" && event.role === "assistant" && event.text) {
        captured.text = event.text;
      }
    });

    try {
      // No inline `[Scheduled task: ...]` prefix — the task system already
      // tracks which run produced what via TaskRunLog, and prepending a
      // string the agent then has to parse out contaminates the single
      // persistent thread the user sees in the chat panel.
      await agent.sendMessage(task.prompt);
      const finished = await agent.waitForIdle(TASK_TIMEOUT_MS);

      if (!finished) {
        // Abort the runaway turn — without this the background agent stays
        // busy forever and the scheduler (which gates on busy) never fires
        // another task.
        await agent.interrupt().catch((err: unknown) => {
          console.warn(`[scheduler] failed to interrupt timed-out task ${task.id}:`, err);
        });
        this.completeRun(run.id, "failed", "Agent timed out");
        return;
      }

      this.completeRun(run.id, "completed", null, captured.text?.slice(0, 500) ?? "(no output)");
    } catch (err) {
      this.completeRun(run.id, "failed", toErrorMessage(err));
    } finally {
      unsubscribe();
      this.firing = false;
    }
  }

  private completeRun(
    runId: string,
    status: "completed" | "failed",
    error: string | null,
    resultSummary?: string,
  ): void {
    this.runs.update((runs) =>
      runs.map((r) => {
        if (r.id !== runId) return r;
        return {
          ...r,
          status,
          durationMs: Date.now() - r.startedAt,
          error,
          resultSummary: resultSummary ?? null,
        };
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Schedule evaluation (pure)
// ---------------------------------------------------------------------------

export function shouldFire(task: Task, now: number): boolean {
  const { schedule } = task;

  switch (schedule.type) {
    case "cron": {
      try {
        const lastRun = task.lastRunAt ?? task.createdAt;
        const cron = new Cron(schedule.cron);
        const next = cron.nextRun(new Date(lastRun));
        return next !== null && next.getTime() <= now;
      } catch {
        console.warn(`[scheduler] invalid cron "${schedule.cron}" for task ${task.id}`);
        return false;
      }
    }

    case "interval":
      if (task.lastRunAt === null) return true;
      return now - task.lastRunAt >= schedule.intervalMs;

    case "once":
      return task.lastRunAt === null && now >= schedule.runAt;
  }
}

// Lazy singleton — TaskManager's constructor reads tasks.json + task-runs.json
// from disk, so eagerly instantiating it at module load forced an import-time
// fs touch and prevented tests from mocking the path. Callers now pull the
// instance via getTaskManager().
let instance: TaskManager | null = null;

export function getTaskManager(): TaskManager {
  if (!instance) instance = new TaskManager();
  return instance;
}

/** Reset the cached TaskManager. Called from teardownResources() so the next
 * read goes back to disk after AGENT_DIR is wiped. */
export function resetTaskManager(): void {
  instance?.stopScheduler();
  instance = null;
}
