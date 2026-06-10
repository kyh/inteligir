// ---------------------------------------------------------------------------
// Renderer task store — the push channel (onTasksUpdated) keeps the panel
// live when the agent/scheduler mutates tasks, and the optimistic create
// doesn't duplicate a task whose push snapshot already landed.
// ---------------------------------------------------------------------------

import { beforeEach, describe, expect, it, vi } from "vitest";

import type { Task } from "@/shared/task";

type TasksListener = (event: { tasks: Task[] }) => void;

const helpers = vi.hoisted(
  (): {
    listeners: Set<TasksListener>;
    unsubscribe: ReturnType<typeof vi.fn>;
    bridgeMock: {
      listTasks: ReturnType<typeof vi.fn>;
      createTask: ReturnType<typeof vi.fn>;
      toggleTask: ReturnType<typeof vi.fn>;
      deleteTask: ReturnType<typeof vi.fn>;
      onTasksUpdated: ReturnType<typeof vi.fn>;
    };
  } => {
    const listeners = new Set<TasksListener>();
    const unsubscribe = vi.fn();
    return {
      listeners,
      unsubscribe,
      bridgeMock: {
        listTasks: vi.fn(),
        createTask: vi.fn(),
        toggleTask: vi.fn(),
        deleteTask: vi.fn(),
        onTasksUpdated: vi.fn((listener: TasksListener) => {
          listeners.add(listener);
          return unsubscribe;
        }),
      },
    };
  },
);

vi.mock("@/renderer/lib/bridge", () => ({
  getBridge: () => helpers.bridgeMock,
}));

vi.mock("@repo/ui/components/sonner", () => ({
  toast: { error: vi.fn() },
}));

const { useTaskStore } = await import("@/renderer/stores/task-store");

function task(over: Partial<Task> = {}): Task {
  return {
    id: "t1",
    label: "T",
    prompt: "do it",
    schedule: { type: "once", runAt: 0 },
    enabled: true,
    lastRunAt: null,
    createdAt: 1,
    ...over,
  };
}

const flushMicrotasks = () => new Promise((r) => setImmediate(r));

function pushSnapshot(tasks: Task[]): void {
  for (const listener of helpers.listeners) listener({ tasks });
}

beforeEach(() => {
  vi.clearAllMocks();
  helpers.listeners.clear();
  useTaskStore.setState({ tasks: [], loading: false, error: null });
  helpers.bridgeMock.listTasks.mockResolvedValue({ tasks: [] });
});

describe("task-store push channel", () => {
  it("init fetches the snapshot and subscribes to onTasksUpdated", async () => {
    helpers.bridgeMock.listTasks.mockResolvedValue({ tasks: [task()] });

    useTaskStore.getState().init();
    await flushMicrotasks();

    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["t1"]);
    expect(helpers.bridgeMock.onTasksUpdated).toHaveBeenCalledOnce();
  });

  it("an agent-side mutation pushes a fresh snapshot into the store", async () => {
    useTaskStore.getState().init();
    await flushMicrotasks();

    pushSnapshot([task({ id: "agent-made", label: "Agent task" })]);

    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["agent-made"]);
  });

  it("init's cleanup unsubscribes the push listener", async () => {
    const cleanup = useTaskStore.getState().init();
    await flushMicrotasks();

    cleanup();
    expect(helpers.unsubscribe).toHaveBeenCalledOnce();
  });

  it("createTask does not duplicate a task whose push snapshot already landed", async () => {
    const created = task({ id: "new-task" });
    helpers.bridgeMock.createTask.mockImplementation(async () => {
      // The main process broadcasts mid-handler, so the push can land before
      // the invoke resolves.
      pushSnapshot([created]);
      return { task: created };
    });
    useTaskStore.getState().init();
    await flushMicrotasks();

    const ok = await useTaskStore
      .getState()
      .createTask({ label: "T", prompt: "x", schedule: { type: "once", runAt: 0 } });

    expect(ok).toBe(true);
    expect(useTaskStore.getState().tasks.map((t) => t.id)).toEqual(["new-task"]);
  });
});
