import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

import {
  TasksFileSchema,
  CreateTaskParamsSchema,
  type Task,
  type CreateTaskParams,
} from "../shared/task";

// ---------------------------------------------------------------------------
// File-based task CRUD — ~/.inteligir/tasks.json
// ---------------------------------------------------------------------------

const TASKS_DIR = path.join(os.homedir(), ".inteligir");
const TASKS_PATH = path.join(TASKS_DIR, "tasks.json");

export function getTasks(): Task[] {
  try {
    const raw = fs.readFileSync(TASKS_PATH, "utf8");
    const result = TasksFileSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data.tasks : [];
  } catch {
    return [];
  }
}

function saveTasks(tasks: Task[]): void {
  fs.mkdirSync(TASKS_DIR, { recursive: true });
  fs.writeFileSync(TASKS_PATH, JSON.stringify({ tasks }, null, 2), "utf8");
}

export function createTask(params: CreateTaskParams): Task {
  // Validate at boundary
  CreateTaskParamsSchema.parse(params);

  const task: Task = {
    id: crypto.randomUUID(),
    label: params.label,
    prompt: params.prompt,
    schedule: params.schedule,
    enabled: true,
    lastRunAt: null,
    createdAt: Date.now(),
  };

  const tasks = getTasks();
  tasks.push(task);
  saveTasks(tasks);
  return task;
}

export function deleteTask(id: string): void {
  const tasks = getTasks().filter((t) => t.id !== id);
  saveTasks(tasks);
}

export function toggleTask(id: string): Task {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) throw new Error(`Task not found: ${id}`);
  task.enabled = !task.enabled;
  saveTasks(tasks);
  return task;
}

export function markTaskRun(id: string, timestamp: number): void {
  const tasks = getTasks();
  const task = tasks.find((t) => t.id === id);
  if (!task) return;
  task.lastRunAt = timestamp;
  // Auto-disable once tasks after firing
  if (task.schedule.type === "once") {
    task.enabled = false;
  }
  saveTasks(tasks);
}
