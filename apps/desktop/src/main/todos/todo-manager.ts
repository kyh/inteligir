// ---------------------------------------------------------------------------
// TodoManager — to-do CRUD over a versioned JsonStore. Mirrors TaskManager's
// shape (store + change notifier + lazy singleton) but holds plain user
// checklist items, not scheduled jobs, so there is no scheduler here.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";
import { Type } from "@sinclair/typebox";
import { Value } from "@sinclair/typebox/value";

import { TodoSchema, type Todo, type CreateTodoParams, type UpdateTodoParams } from "@/shared/todo";
import { isRecord } from "@/shared/ipc";
import { JsonStore, inteligirPath, type FsAdapter } from "@/main/lib/json-store";

// ---------------------------------------------------------------------------
// Store schema — versioned wire format. In memory the store is a bare Todo[];
// on disk it is wrapped in `{ version, todos }` so future schema changes can
// migrate instead of quarantining the file.
// ---------------------------------------------------------------------------

const TODOS_VERSION = 2;

const TodosFileSchema = Type.Object(
  { version: Type.Literal(TODOS_VERSION), todos: Type.Array(TodoSchema) },
  { additionalProperties: false },
);

// v1 todos predate the sync fields (updatedAt, googleTaskId). Backfill them:
// updatedAt seeds from createdAt (best available), googleTaskId starts unlinked.
function migrateV1ToV2(raw: unknown): unknown {
  const todos = isRecord(raw) && Array.isArray(raw["todos"]) ? raw["todos"] : [];
  const upgraded = todos.map((t) => {
    const src = isRecord(t) ? t : {};
    const createdAt = typeof src["createdAt"] === "number" ? src["createdAt"] : Date.now();
    return Object.assign({}, src, { updatedAt: createdAt, googleTaskId: null });
  });
  return { version: 2, todos: upgraded };
}

// ---------------------------------------------------------------------------
// Change notification — push channel for the To-Do panel. Registered from the
// Electron-side composition root (app-machine) so this module stays
// electron-free and unit-testable, same seam as TaskManager.
// ---------------------------------------------------------------------------

let todosChangedNotifier: ((todos: Todo[]) => void) | null = null;

export function setTodosChangedNotifier(notifier: ((todos: Todo[]) => void) | null): void {
  todosChangedNotifier = notifier;
}

export type TodoManagerOptions = {
  /** Override filesystem for testing */
  fs?: FsAdapter;
  /** Override path for testing */
  todosPath?: string;
};

export class TodoManager {
  private readonly todos: JsonStore<Todo[]>;

  constructor(opts?: TodoManagerOptions) {
    this.todos = new JsonStore<Todo[]>(
      opts?.todosPath ?? inteligirPath("todos.json"),
      TodosFileSchema,
      [],
      {
        fs: opts?.fs,
        versioning: {
          current: TODOS_VERSION,
          // todos.json was born versioned — it never had an unversioned era,
          // so any file lacking a `version` field is corrupt, not legacy.
          fromLegacy: () => {
            throw new Error("todos.json has no unversioned format");
          },
          migrations: { 1: migrateV1ToV2 },
        },
        // Re-check against the concrete schema purely to narrow the type —
        // JsonStore already validated before calling decode.
        decode: (raw) => {
          if (!Value.Check(TodosFileSchema, raw)) throw new Error("todos file shape rejected");
          return raw.todos;
        },
        encode: (todos) => ({ version: TODOS_VERSION, todos }),
      },
    );
  }

  // ---- CRUD -----------------------------------------------------------------

  getTodos(): Todo[] {
    return this.todos.read();
  }

  createTodo(params: CreateTodoParams): Todo {
    const now = Date.now();
    const todo: Todo = {
      id: crypto.randomUUID(),
      title: params.title,
      notes: params.notes ?? "",
      done: false,
      priority: params.priority ?? "medium",
      dueAt: params.dueAt ?? null,
      createdAt: now,
      updatedAt: now,
      completedAt: null,
      googleTaskId: null,
    };
    this.todos.update((todos) => [...todos, todo]);
    this.notifyTodosChanged();
    return todo;
  }

  updateTodo(params: UpdateTodoParams): Todo {
    let updated: Todo | undefined;
    this.todos.update((todos) =>
      todos.map((t) => {
        if (t.id !== params.id) return t;
        // Only overwrite keys the caller actually sent. `dueAt: null` is a
        // real value (clear the date), so we test key presence, not truthiness.
        const next: Todo = {
          ...t,
          ...(params.title !== undefined ? { title: params.title } : {}),
          ...(params.notes !== undefined ? { notes: params.notes } : {}),
          ...(params.priority !== undefined ? { priority: params.priority } : {}),
          ...("dueAt" in params ? { dueAt: params.dueAt ?? null } : {}),
          updatedAt: Date.now(),
        };
        if (params.done !== undefined) {
          next.done = params.done;
          next.completedAt = params.done ? (t.completedAt ?? next.updatedAt) : null;
        }
        updated = next;
        return next;
      }),
    );
    if (!updated) throw new Error(`Todo not found: ${params.id}`);
    this.notifyTodosChanged();
    return updated;
  }

  toggleTodo(id: string): Todo {
    let toggled: Todo | undefined;
    this.todos.update((todos) =>
      todos.map((t) => {
        if (t.id !== id) return t;
        const now = Date.now();
        const done = !t.done;
        toggled = { ...t, done, completedAt: done ? now : null, updatedAt: now };
        return toggled;
      }),
    );
    if (!toggled) throw new Error(`Todo not found: ${id}`);
    this.notifyTodosChanged();
    return toggled;
  }

  deleteTodo(id: string): void {
    this.todos.update((todos) => todos.filter((t) => t.id !== id));
    this.notifyTodosChanged();
  }

  /** Drop every completed item; returns what remains. */
  clearCompleted(): Todo[] {
    this.todos.update((todos) => todos.filter((t) => !t.done));
    this.notifyTodosChanged();
    return this.getTodos();
  }

  /**
   * Apply a sync reconciliation in one atomic write: `upserts` replace any
   * todo with a matching id and append the rest (imports + remote-wins
   * updates + export links), `deletes` remove by id. The upsert objects carry
   * their own updatedAt/googleTaskId from the sync planner — this method does
   * NOT bump updatedAt, so a remote-origin change keeps the remote timestamp
   * and won't immediately look "locally newer" on the next sync.
   */
  applySync(upserts: Todo[], deletes: string[]): void {
    if (upserts.length === 0 && deletes.length === 0) return;
    const byId = new Map(upserts.map((t) => [t.id, t]));
    const deleted = new Set(deletes);
    this.todos.update((todos) => {
      const merged = todos.filter((t) => !deleted.has(t.id)).map((t) => byId.get(t.id) ?? t);
      const seen = new Set(merged.map((t) => t.id));
      for (const t of upserts) if (!seen.has(t.id)) merged.push(t);
      return merged;
    });
    this.notifyTodosChanged();
  }

  /** Push the fresh snapshot to whoever registered (renderer broadcast). */
  private notifyTodosChanged(): void {
    try {
      todosChangedNotifier?.(this.getTodos());
    } catch (err) {
      // Non-fatal: the panel falls back to its mount-time fetch.
      console.warn("[todos] change notification failed:", err);
    }
  }
}

// Lazy singleton — same rationale as getTaskManager(): the constructor reads
// todos.json from disk, so eager instantiation would force an import-time fs
// touch and block tests from mocking the path.
let instance: TodoManager | null = null;

export function getTodoManager(): TodoManager {
  if (!instance) instance = new TodoManager();
  return instance;
}

/** Reset the cached TodoManager. Called from teardownResources() so the next
 * read goes back to disk after AGENT_DIR is wiped. */
export function resetTodoManager(): void {
  instance = null;
}
