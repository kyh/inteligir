import { Cron } from "croner";

import type { Task } from "../shared/task";

import type { Agent } from "./agent";

const TASK_TIMEOUT_MS = 5 * 60 * 1000;
import { getTasks, markTaskRun } from "./task-store";
import { startRun, completeRun, failRun } from "./task-run-store";
import { toErrorMessage } from "../shared/ipc";

// ---------------------------------------------------------------------------
// Task scheduler — polls tasks.json and fires agent.sendMessage()
// ---------------------------------------------------------------------------

const POLL_INTERVAL_MS = 15_000;

export class TaskScheduler {
  private timer: ReturnType<typeof setInterval> | null = null;
  private getAgent: () => Agent | null;

  constructor(getAgent: () => Agent | null) {
    this.getAgent = getAgent;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    const agent = this.getAgent();
    if (!agent) return;

    const state = agent.getState();
    if (state.status === "busy") return;

    const now = Date.now();
    const tasks = getTasks();

    for (const task of tasks) {
      if (!task.enabled) continue;
      if (!shouldFire(task, now)) continue;

      void this.fireTask(agent, task, now);
      // Only fire one task per tick to avoid overloading
      break;
    }
  }

  private async fireTask(agent: Agent, task: Task, now: number): Promise<void> {
    markTaskRun(task.id, now);
    const run = startRun(task.id);
    const prefix = `[Scheduled task: ${task.label}]\n\n`;

    try {
      await agent.sendMessage(prefix + task.prompt);
      const finished = await agent.waitForIdle(TASK_TIMEOUT_MS);

      if (!finished) {
        failRun(run.id, "Agent timed out");
        return;
      }

      const entries = agent.getMessages();
      const last = entries.findLast((e) => e.kind === "assistant");
      completeRun(run.id, last?.text.slice(0, 500) ?? "(no output)");
    } catch (err) {
      failRun(run.id, toErrorMessage(err));
    }
  }
}

// ---------------------------------------------------------------------------
// Schedule evaluation
// ---------------------------------------------------------------------------

function shouldFire(task: Task, now: number): boolean {
  const { schedule } = task;

  switch (schedule.type) {
    case "cron": {
      try {
        const lastRun = task.lastRunAt ?? task.createdAt;
        const cron = new Cron(schedule.cron);
        const next = cron.nextRun(new Date(lastRun));
        return next !== null && next.getTime() <= now;
      } catch {
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
