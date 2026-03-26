import { describe, it, expect } from "vitest";
import { TaskManager, shouldFire } from "@/main/tasks/task-manager";
import type { FsAdapter } from "@/main/lib/json-store";
import type { Task } from "@/shared/task";

function memoryFs(): FsAdapter {
  const files = new Map<string, string>();
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, content) => { files.set(path, content); },
  };
}

function createManager(): TaskManager {
  return new TaskManager({
    fs: memoryFs(),
    tasksPath: "/tasks.json",
    runsPath: "/runs.json",
  });
}

describe("TaskManager CRUD", () => {
  it("starts with empty tasks", () => {
    const mgr = createManager();
    expect(mgr.getTasks()).toEqual([]);
  });

  it("creates a task", () => {
    const mgr = createManager();
    const task = mgr.createTask({
      label: "Test",
      prompt: "do something",
      schedule: { type: "once", runAt: Date.now() },
    });

    expect(task.label).toBe("Test");
    expect(task.prompt).toBe("do something");
    expect(task.enabled).toBe(true);
    expect(mgr.getTasks()).toHaveLength(1);
  });

  it("deletes a task", () => {
    const mgr = createManager();
    const task = mgr.createTask({
      label: "Delete me",
      prompt: "x",
      schedule: { type: "once", runAt: 0 },
    });

    mgr.deleteTask(task.id);
    expect(mgr.getTasks()).toHaveLength(0);
  });

  it("toggles a task", () => {
    const mgr = createManager();
    const task = mgr.createTask({
      label: "Toggle",
      prompt: "x",
      schedule: { type: "once", runAt: 0 },
    });

    const toggled = mgr.toggleTask(task.id);
    expect(toggled.enabled).toBe(false);

    const toggledBack = mgr.toggleTask(task.id);
    expect(toggledBack.enabled).toBe(true);
  });

  it("throws on toggle of nonexistent task", () => {
    const mgr = createManager();
    expect(() => mgr.toggleTask("nonexistent")).toThrow("Task not found");
  });

  it("creates multiple tasks and lists them", () => {
    const mgr = createManager();
    mgr.createTask({ label: "A", prompt: "a", schedule: { type: "once", runAt: 0 } });
    mgr.createTask({ label: "B", prompt: "b", schedule: { type: "once", runAt: 0 } });
    mgr.createTask({ label: "C", prompt: "c", schedule: { type: "once", runAt: 0 } });

    expect(mgr.getTasks()).toHaveLength(3);
    expect(mgr.getTasks().map((t) => t.label)).toEqual(["A", "B", "C"]);
  });
});

describe("shouldFire", () => {
  const base: Task = {
    id: "t1",
    label: "Test",
    prompt: "x",
    schedule: { type: "once", runAt: 1000 },
    enabled: true,
    lastRunAt: null,
    createdAt: 500,
  };

  it("once: fires when now >= runAt and never run", () => {
    expect(shouldFire(base, 1000)).toBe(true);
    expect(shouldFire(base, 2000)).toBe(true);
  });

  it("once: does not fire before runAt", () => {
    expect(shouldFire(base, 999)).toBe(false);
  });

  it("once: does not fire if already run", () => {
    expect(shouldFire({ ...base, lastRunAt: 1000 }, 2000)).toBe(false);
  });

  it("interval: fires immediately if never run", () => {
    const task: Task = { ...base, schedule: { type: "interval", intervalMs: 60_000 } };
    expect(shouldFire(task, 1000)).toBe(true);
  });

  it("interval: fires after interval elapsed", () => {
    const task: Task = {
      ...base,
      schedule: { type: "interval", intervalMs: 60_000 },
      lastRunAt: 1000,
    };
    expect(shouldFire(task, 61_000)).toBe(true);
  });

  it("interval: does not fire before interval", () => {
    const task: Task = {
      ...base,
      schedule: { type: "interval", intervalMs: 60_000 },
      lastRunAt: 1000,
    };
    expect(shouldFire(task, 30_000)).toBe(false);
  });

  it("cron: returns false for invalid cron", () => {
    const task: Task = { ...base, schedule: { type: "cron", cron: "invalid" } };
    expect(shouldFire(task, Date.now())).toBe(false);
  });
});
