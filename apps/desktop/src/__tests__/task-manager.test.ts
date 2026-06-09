import { afterEach, describe, it, expect, vi } from "vitest";
import { TaskManager } from "@/main/tasks/task-manager";
import type { FsAdapter } from "@/main/lib/json-store";
import type { TaskRunLog } from "@/shared/task";

function memoryFs(seed: Record<string, unknown> = {}): FsAdapter {
  const files = new Map<string, string>();
  for (const [k, v] of Object.entries(seed)) files.set(k, JSON.stringify(v));
  return {
    read: (path) => files.get(path) ?? null,
    write: (path, content) => {
      files.set(path, content);
    },
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

const flush = () => new Promise((r) => setTimeout(r, 0));

function fakeBackgroundAgent(over: { busy?: boolean; lastText?: string } = {}) {
  return {
    getState: () => ({ status: over.busy ? "busy" : "idle", error: null }),
    sendMessage: vi.fn(async () => {}),
    waitForIdle: vi.fn(async () => true),
    getLastAssistantText: () => over.lastText ?? "done",
    steer: vi.fn(),
    followUp: vi.fn(),
    interrupt: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn(),
  };
}

describe("TaskManager scheduler + runs", () => {
  let mgr: TaskManager | null = null;
  afterEach(() => {
    mgr?.stopScheduler();
    mgr = null;
  });

  it("getRunsSince filters by startedAt (inclusive)", () => {
    const runs: TaskRunLog[] = [
      { id: "a", taskId: "t", startedAt: 100, durationMs: 1, status: "completed", error: null, resultSummary: "x" },
      { id: "b", taskId: "t", startedAt: 200, durationMs: 1, status: "completed", error: null, resultSummary: "y" },
      { id: "c", taskId: "t", startedAt: 300, durationMs: 1, status: "failed", error: "e", resultSummary: null },
    ];
    mgr = new TaskManager({
      fs: memoryFs({ "/runs.json": runs }),
      tasksPath: "/tasks.json",
      runsPath: "/runs.json",
    });
    expect(mgr.getRunsSince(200).map((r) => r.id)).toEqual(["b", "c"]);
    expect(mgr.getRunsSince(0)).toHaveLength(3);
    expect(mgr.getRunsSince(301)).toHaveLength(0);
  });

  it("a due task fires against the background agent and logs a completed run", async () => {
    mgr = createManager();
    mgr.createTask({ label: "T", prompt: "do it", schedule: { type: "interval", intervalMs: 1000 } });
    const agent = fakeBackgroundAgent({ lastText: "all done" });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(agent.sendMessage).toHaveBeenCalledWith("do it");
    const last = mgr.getRunsSince(0).at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.resultSummary).toBe("all done");
  });

  it("does not fire while the background agent is busy", async () => {
    mgr = createManager();
    mgr.createTask({ label: "T", prompt: "do it", schedule: { type: "interval", intervalMs: 1000 } });
    const agent = fakeBackgroundAgent({ busy: true });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(mgr.getRunsSince(0)).toHaveLength(0);
  });

  it("does not fire when there is no background agent", async () => {
    mgr = createManager();
    mgr.createTask({ label: "T", prompt: "do it", schedule: { type: "interval", intervalMs: 1000 } });

    mgr.startScheduler(() => null);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(mgr.getRunsSince(0)).toHaveLength(0);
  });
});
