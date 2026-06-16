import { afterEach, describe, it, expect, vi } from "vitest";
import { TaskManager, setTasksChangedNotifier } from "@/main/tasks/task-manager";
import type { FsAdapter } from "@/main/lib/json-store";
import type { Task, TaskRunLog } from "@/shared/task";

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

  it("persists tasks in the versioned wire format", () => {
    const fs = memoryFs();
    const mgr = new TaskManager({ fs, tasksPath: "/tasks.json", runsPath: "/runs.json" });
    mgr.createTask({ label: "T", prompt: "x", schedule: { type: "once", runAt: 0 } });

    const onDisk: unknown = JSON.parse(fs.files.get("/tasks.json") ?? "");
    expect(onDisk).toMatchObject({ version: 1 });
  });

  it("migrates a legacy bare-array tasks.json and rewrites it versioned", () => {
    const legacyTask: Task = {
      id: "t1",
      label: "Legacy",
      prompt: "do",
      schedule: { type: "once", runAt: 0 },
      enabled: true,
      lastRunAt: null,
      createdAt: 1,
    };
    const fs = memoryFs({ "/tasks.json": [legacyTask] });
    const mgr = new TaskManager({ fs, tasksPath: "/tasks.json", runsPath: "/runs.json" });

    expect(mgr.getTasks()).toEqual([legacyTask]);
    expect(JSON.parse(fs.files.get("/tasks.json") ?? "")).toEqual({
      version: 1,
      tasks: [legacyTask],
    });
  });
});

const flush = () => new Promise((r) => setTimeout(r, 0));

/** Raw pi-shaped assistant message_end, as the background agent would emit. */
function rawAssistantMessageEnd(text: string): unknown {
  return {
    type: "message_end",
    message: { role: "assistant", content: [{ type: "text", text }], stopReason: "stop" },
  };
}

function fakeBackgroundAgent(
  over: { busy?: boolean; turnTexts?: string[]; finishes?: boolean } = {},
) {
  const listeners = new Set<(event: unknown) => void>();
  return {
    getState: () => ({ status: over.busy ? "busy" : "idle", error: null }),
    // Emits this turn's assistant text through the event stream — the path
    // TaskManager must capture, since getLastAssistantText() below always
    // reports a stale previous turn.
    sendMessage: vi.fn(async () => {
      for (const text of over.turnTexts ?? ["all done"]) {
        for (const listener of listeners) listener(rawAssistantMessageEnd(text));
      }
    }),
    waitForIdle: vi.fn(async () => over.finishes ?? true),
    getLastAssistantText: () => "STALE PREVIOUS TURN",
    steer: vi.fn(),
    followUp: vi.fn(),
    interrupt: vi.fn(async () => true),
    start: vi.fn(),
    stop: vi.fn(),
    subscribe: vi.fn((listener: (event: unknown) => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }),
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
      {
        id: "a",
        taskId: "t",
        startedAt: 100,
        durationMs: 1,
        status: "completed",
        error: null,
        resultSummary: "x",
      },
      {
        id: "b",
        taskId: "t",
        startedAt: 200,
        durationMs: 1,
        status: "completed",
        error: null,
        resultSummary: "y",
      },
      {
        id: "c",
        taskId: "t",
        startedAt: 300,
        durationMs: 1,
        status: "failed",
        error: "e",
        resultSummary: null,
      },
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
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    const agent = fakeBackgroundAgent({ turnTexts: ["all done"] });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(agent.sendMessage).toHaveBeenCalledWith("do it");
    const last = mgr.getRunsSince(0).at(-1);
    expect(last?.status).toBe("completed");
    expect(last?.resultSummary).toBe("all done");
  });

  it("captures THIS turn's text from the event stream, never getLastAssistantText()", async () => {
    mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    // getLastAssistantText() always reports "STALE PREVIOUS TURN" (the
    // documented post-abort behavior); the live events carry the real result.
    const agent = fakeBackgroundAgent({ turnTexts: ["first chunk", "fresh result"] });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    const last = mgr.getRunsSince(0).at(-1);
    expect(last?.resultSummary).toBe("fresh result");
    expect(last?.resultSummary).not.toContain("STALE");
  });

  it("logs (no output) when the turn produced no assistant text", async () => {
    mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    const agent = fakeBackgroundAgent({ turnTexts: [] });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(mgr.getRunsSince(0).at(-1)?.resultSummary).toBe("(no output)");
  });

  it("a timed-out run interrupts the runaway turn and logs a failure", async () => {
    mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    const agent = fakeBackgroundAgent({ finishes: false });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    // Without the interrupt the background agent stays busy forever and the
    // scheduler (gated on busy) never fires another task.
    expect(agent.interrupt).toHaveBeenCalledOnce();
    const last = mgr.getRunsSince(0).at(-1);
    expect(last?.status).toBe("failed");
    expect(last?.error).toBe("Agent timed out");
  });

  it("does not fire while the background agent is busy", async () => {
    mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    const agent = fakeBackgroundAgent({ busy: true });

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(agent.sendMessage).not.toHaveBeenCalled();
    expect(mgr.getRunsSince(0)).toHaveLength(0);
  });

  it("does not fire when there is no background agent", async () => {
    mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });

    mgr.startScheduler(() => null);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();

    expect(mgr.getRunsSince(0)).toHaveLength(0);
  });
});

describe("TaskManager change notifications (push channel)", () => {
  afterEach(() => {
    setTasksChangedNotifier(null);
  });

  it("notifies with the fresh snapshot on create, toggle, and delete", () => {
    const snapshots: Task[][] = [];
    setTasksChangedNotifier((tasks) => snapshots.push(tasks));
    const mgr = createManager();

    const task = mgr.createTask({
      label: "T",
      prompt: "x",
      schedule: { type: "once", runAt: 0 },
    });
    expect(snapshots.at(-1)?.map((t) => t.id)).toEqual([task.id]);

    mgr.toggleTask(task.id);
    expect(snapshots.at(-1)?.[0]?.enabled).toBe(false);

    mgr.deleteTask(task.id);
    expect(snapshots.at(-1)).toEqual([]);
    expect(snapshots).toHaveLength(3);
  });

  it("notifies when the scheduler marks a run (lastRunAt / once auto-disable)", async () => {
    const snapshots: Task[][] = [];
    setTasksChangedNotifier((tasks) => snapshots.push(tasks));
    const mgr = createManager();
    mgr.createTask({
      label: "T",
      prompt: "do it",
      schedule: { type: "interval", intervalMs: 1000 },
    });
    const agent = fakeBackgroundAgent();

    mgr.startScheduler(() => agent as never);
    (mgr as unknown as { tick: () => void }).tick();
    await flush();
    mgr.stopScheduler();

    expect(snapshots.at(-1)?.[0]?.lastRunAt).not.toBeNull();
  });

  it("a throwing notifier does not break the mutation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      setTasksChangedNotifier(() => {
        throw new Error("renderer gone");
      });
      const mgr = createManager();
      const task = mgr.createTask({
        label: "T",
        prompt: "x",
        schedule: { type: "once", runAt: 0 },
      });
      expect(mgr.getTasks().map((t) => t.id)).toEqual([task.id]);
    } finally {
      warn.mockRestore();
    }
  });
});
