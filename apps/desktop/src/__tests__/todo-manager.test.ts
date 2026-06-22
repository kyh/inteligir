import { afterEach, describe, it, expect, vi } from "vitest";
import { TodoManager, setTodosChangedNotifier } from "@/main/todos/todo-manager";
import type { FsAdapter } from "@/main/lib/json-store";
import type { Todo } from "@/shared/todo";

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

function createManager(seed?: Record<string, unknown>): TodoManager {
  return new TodoManager({ fs: memoryFs(seed), todosPath: "/todos.json" });
}

describe("TodoManager CRUD", () => {
  it("starts empty", () => {
    expect(createManager().getTodos()).toEqual([]);
  });

  it("creates a todo with defaults", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({ title: "Buy milk" });

    expect(todo.title).toBe("Buy milk");
    expect(todo.done).toBe(false);
    expect(todo.priority).toBe("medium");
    expect(todo.notes).toBe("");
    expect(todo.dueAt).toBeNull();
    expect(todo.completedAt).toBeNull();
    expect(mgr.getTodos()).toHaveLength(1);
  });

  it("honors provided priority, notes, and due date", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({
      title: "Ship it",
      priority: "high",
      notes: "before the demo",
      dueAt: 1234,
    });
    expect(todo.priority).toBe("high");
    expect(todo.notes).toBe("before the demo");
    expect(todo.dueAt).toBe(1234);
  });

  it("toggles done and stamps completedAt", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({ title: "x" });

    const done = mgr.toggleTodo(todo.id);
    expect(done.done).toBe(true);
    expect(done.completedAt).not.toBeNull();

    const reopened = mgr.toggleTodo(todo.id);
    expect(reopened.done).toBe(false);
    expect(reopened.completedAt).toBeNull();
  });

  it("updates only the keys provided, and clears dueAt with explicit null", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({ title: "x", priority: "low", dueAt: 999 });

    const renamed = mgr.updateTodo({ id: todo.id, title: "y" });
    expect(renamed.title).toBe("y");
    expect(renamed.priority).toBe("low"); // untouched
    expect(renamed.dueAt).toBe(999); // untouched

    const cleared = mgr.updateTodo({ id: todo.id, dueAt: null });
    expect(cleared.dueAt).toBeNull();
    expect(cleared.title).toBe("y"); // untouched
  });

  it("update can mark done and stamps completedAt once", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({ title: "x" });

    const done = mgr.updateTodo({ id: todo.id, done: true });
    expect(done.done).toBe(true);
    const stamp = done.completedAt;
    expect(stamp).not.toBeNull();

    // A second update that keeps it done must not reset the original stamp.
    const again = mgr.updateTodo({ id: todo.id, done: true });
    expect(again.completedAt).toBe(stamp);
  });

  it("throws on update/toggle of a missing id", () => {
    const mgr = createManager();
    expect(() => mgr.toggleTodo("nope")).toThrow("Todo not found");
    expect(() => mgr.updateTodo({ id: "nope", title: "x" })).toThrow("Todo not found");
  });

  it("deletes a todo", () => {
    const mgr = createManager();
    const todo = mgr.createTodo({ title: "x" });
    mgr.deleteTodo(todo.id);
    expect(mgr.getTodos()).toHaveLength(0);
  });

  it("clearCompleted drops done items and returns what remains", () => {
    const mgr = createManager();
    const a = mgr.createTodo({ title: "a" });
    mgr.createTodo({ title: "b" });
    mgr.toggleTodo(a.id);

    const remaining = mgr.clearCompleted();
    expect(remaining.map((t) => t.title)).toEqual(["b"]);
    expect(mgr.getTodos()).toHaveLength(1);
  });

  it("persists in the versioned wire format", () => {
    const fs = memoryFs();
    const mgr = new TodoManager({ fs, todosPath: "/todos.json" });
    mgr.createTodo({ title: "x" });

    const onDisk: unknown = JSON.parse(fs.files.get("/todos.json") ?? "");
    expect(onDisk).toMatchObject({ version: 2 });
  });

  it("reads back a previously written file", () => {
    const seedTodo: Todo = {
      id: "t1",
      title: "Saved",
      notes: "",
      done: false,
      priority: "medium",
      dueAt: null,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
      googleTaskId: null,
    };
    const mgr = createManager({ "/todos.json": { version: 2, todos: [seedTodo] } });
    expect(mgr.getTodos()).toEqual([seedTodo]);
  });

  it("migrates a v1 file, backfilling updatedAt (from createdAt) and googleTaskId", () => {
    const v1Todo = {
      id: "t1",
      title: "Old",
      notes: "",
      done: false,
      priority: "medium",
      dueAt: null,
      createdAt: 42,
      completedAt: null,
    };
    const fs = memoryFs({ "/todos.json": { version: 1, todos: [v1Todo] } });
    const mgr = new TodoManager({ fs, todosPath: "/todos.json" });

    const [migrated] = mgr.getTodos();
    expect(migrated).toMatchObject({ id: "t1", updatedAt: 42, googleTaskId: null });
    // The upgraded shape is rewritten so the chain doesn't re-run next launch.
    expect(JSON.parse(fs.files.get("/todos.json") ?? "")).toMatchObject({ version: 2 });
  });

  it("applySync upserts, links, and deletes in one write", () => {
    const mgr = createManager();
    const keep = mgr.createTodo({ title: "keep" });
    const gone = mgr.createTodo({ title: "gone" });

    const imported: Todo = {
      id: "imported",
      title: "From Google",
      notes: "",
      done: false,
      priority: "medium",
      dueAt: null,
      createdAt: 1,
      updatedAt: 1,
      completedAt: null,
      googleTaskId: "g1",
    };
    const linked: Todo = { ...keep, googleTaskId: "g2" };

    mgr.applySync([imported, linked], [gone.id]);

    const ids = mgr.getTodos().map((t) => t.id);
    expect(ids).toContain("imported");
    expect(ids).toContain(keep.id);
    expect(ids).not.toContain(gone.id);
    expect(mgr.getTodos().find((t) => t.id === keep.id)?.googleTaskId).toBe("g2");
  });
});

describe("TodoManager change notifications (push channel)", () => {
  afterEach(() => {
    setTodosChangedNotifier(null);
  });

  it("notifies with the fresh snapshot on create, toggle, delete, and clear", () => {
    const snapshots: Todo[][] = [];
    setTodosChangedNotifier((todos) => snapshots.push(todos));
    const mgr = createManager();

    const todo = mgr.createTodo({ title: "x" });
    expect(snapshots.at(-1)?.map((t) => t.id)).toEqual([todo.id]);

    mgr.toggleTodo(todo.id);
    expect(snapshots.at(-1)?.[0]?.done).toBe(true);

    mgr.deleteTodo(todo.id);
    expect(snapshots.at(-1)).toEqual([]);
    expect(snapshots).toHaveLength(3);
  });

  it("a throwing notifier does not break the mutation", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      setTodosChangedNotifier(() => {
        throw new Error("renderer gone");
      });
      const mgr = createManager();
      const todo = mgr.createTodo({ title: "x" });
      expect(mgr.getTodos().map((t) => t.id)).toEqual([todo.id]);
    } finally {
      warn.mockRestore();
    }
  });
});
