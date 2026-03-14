import crypto from "node:crypto";

import {
  TasksFileSchema,
  CreateTaskParamsSchema,
  type Task,
  type CreateTaskParams,
} from "../shared/task";
import { inteligirPath, readJson, writeJson } from "./json-store";

// ---------------------------------------------------------------------------
// File-based task CRUD — ~/.inteligir/tasks.json
// ---------------------------------------------------------------------------

const TASKS_PATH = inteligirPath("tasks.json");

export function getTasks(): Task[] {
  const file = readJson(TASKS_PATH, TasksFileSchema);
  return file?.tasks ?? [];
}

function saveTasks(tasks: Task[]): void {
  writeJson(TASKS_PATH, { tasks });
}

export function createTask(params: CreateTaskParams): Task {
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
  if (task.schedule.type === "once") {
    task.enabled = false;
  }
  saveTasks(tasks);
}
