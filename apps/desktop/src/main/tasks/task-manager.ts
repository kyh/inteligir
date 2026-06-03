// ---------------------------------------------------------------------------
// TaskManager — unified task CRUD, scheduling, and run logging.
// Absorbs task-store, task-scheduler, and task-run-store into one deep module.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { z } from "zod";
import { Cron } from "croner";

import type { Agent } from "@/agent/agent";
import {
  TasksFileSchema,
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
// Store schemas
// ---------------------------------------------------------------------------

const TasksSchema = TasksFileSchema.shape.tasks;
const RunsSchema = z.array(TaskRunLogSchema);

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

  // Scheduler state
  private timer: ReturnType<typeof setInterval> | null = null;
  private firing = false;
  private getAgent: (() => Agent | null) | null = null;

  constructor(opts?: TaskManagerOptions) {
    this.tasks = new JsonStore(
      opts?.tasksPath ?? inteligirPath("tasks.json"),
      TasksSchema,
      [],
      opts?.fs,
    );
    this.runs = new JsonStore(
      opts?.runsPath ?? inteligirPath("task-runs.json"),
      RunsSchema,
      [],
      opts?.fs,
    );
  }

  // ---- CRUD -----------------------------------------------------------------

  getTasks(): Task[] {
    return this.tasks.read();
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
    return task;
  }

  deleteTask(id: string): void {
    this.tasks.update((tasks) => tasks.filter((t) => t.id !== id));
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
    return toggled;
  }

  // ---- Scheduler ------------------------------------------------------------

  startScheduler(getAgent: () => Agent | null): void {
    if (this.timer) return;
    this.getAgent = getAgent;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stopScheduler(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.getAgent = null;
  }

  private tick(): void {
    if (this.firing) return;
    const agent = this.getAgent?.();
    if (!agent) return;

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

    try {
      // No inline `[Scheduled task: ...]` prefix — the task system already
      // tracks which run produced what via TaskRunLog, and prepending a
      // string the agent then has to parse out contaminates the single
      // persistent thread the user sees in the chat panel.
      await agent.sendMessage(task.prompt);
      const finished = await agent.waitForIdle(TASK_TIMEOUT_MS);

      if (!finished) {
        this.completeRun(run.id, "failed", "Agent timed out");
        return;
      }

      const lastText = agent.getLastAssistantText();
      this.completeRun(run.id, "completed", null, lastText?.slice(0, 500) ?? "(no output)");
    } catch (err) {
      this.completeRun(run.id, "failed", toErrorMessage(err));
    } finally {
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
