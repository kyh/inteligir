import { type Static, Type } from "@sinclair/typebox";

// ---------------------------------------------------------------------------
// To-do item — a user (or agent) authored checklist entry. Distinct from the
// scheduled "tasks" system (shared/task.ts): tasks are cron jobs the agent
// runs on its own; todos are things the *user* means to do, with a due date
// and priority. The agent can read and manage them through the manage_todos
// tool so "remind me to…" / "what's on my list?" work by voice.
// ---------------------------------------------------------------------------

export const TodoPrioritySchema = Type.Union(
  [Type.Literal("low"), Type.Literal("medium"), Type.Literal("high")],
  { description: "Priority: 'low' | 'medium' | 'high'" },
);

export type TodoPriority = Static<typeof TodoPrioritySchema>;

export const TodoSchema = Type.Object(
  {
    id: Type.String(),
    title: Type.String(),
    // Freeform detail; "" when none. Kept non-optional so the on-disk shape is
    // stable and the renderer never has to guard for undefined.
    notes: Type.String(),
    done: Type.Boolean(),
    priority: TodoPrioritySchema,
    // Epoch ms, or null for "no due date".
    dueAt: Type.Union([Type.Number(), Type.Null()]),
    createdAt: Type.Number(),
    // Epoch ms of the last content change. Drives last-write-wins against the
    // Google Tasks `updated` timestamp during sync.
    updatedAt: Type.Number(),
    // Epoch ms the item was marked done; null while open. Lets us show
    // "completed" ordering and a future "completed today" view.
    completedAt: Type.Union([Type.Number(), Type.Null()]),
    // Linked Google Tasks task id, or null when this todo only lives locally.
    // Set after a successful export; matched on to reconcile future syncs.
    googleTaskId: Type.Union([Type.String(), Type.Null()]),
  },
  { additionalProperties: false },
);

export type Todo = Static<typeof TodoSchema>;

// A locally-deleted todo that was linked to Google Tasks. Recorded so the next
// sync can delete the remote task (propagating the local delete) and not
// re-import it. Cleared once the remote delete lands (or the task is already
// gone remotely).
export const TodoTombstoneSchema = Type.Object(
  { googleTaskId: Type.String(), deletedAt: Type.Number() },
  { additionalProperties: false },
);

export type TodoTombstone = Static<typeof TodoTombstoneSchema>;

// ---------------------------------------------------------------------------
// Method params & results — mirror the task.ts shapes so the IPC registry,
// agent port, and renderer store all read the same way.
// ---------------------------------------------------------------------------

export const CreateTodoParamsSchema = Type.Object(
  {
    title: Type.String({ minLength: 1 }),
    notes: Type.Optional(Type.String()),
    priority: Type.Optional(TodoPrioritySchema),
    dueAt: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
  },
  { additionalProperties: false },
);

export type CreateTodoParams = Static<typeof CreateTodoParamsSchema>;

// Every field but `id` is optional — a patch. Sending `dueAt: null` clears the
// due date; omitting it leaves the existing value untouched (the manager
// distinguishes "key absent" from "value null").
export const UpdateTodoParamsSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    title: Type.Optional(Type.String({ minLength: 1 })),
    notes: Type.Optional(Type.String()),
    priority: Type.Optional(TodoPrioritySchema),
    dueAt: Type.Optional(Type.Union([Type.Number(), Type.Null()])),
    done: Type.Optional(Type.Boolean()),
  },
  { additionalProperties: false },
);

export type UpdateTodoParams = Static<typeof UpdateTodoParamsSchema>;

export type CreateTodoResult = { todo: Todo };
export type ListTodosResult = { todos: Todo[] };
export type UpdateTodoResult = { todo: Todo };
export type ToggleTodoResult = { todo: Todo };
export type DeleteTodoResult = { ok: true };
export type ClearCompletedTodosResult = { todos: Todo[] };

/** Outcome of a Google Tasks sync. `ok:false` carries a short, already-cleaned
 * message (e.g. the connector isn't connected) safe to show inline. */
export type TodoSyncResult =
  | { ok: true; pulled: number; pushed: number; deleted: number }
  | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Display + ordering helpers (pure) — shared by the panel and the agent tool
// so both speak about a todo the same way.
// ---------------------------------------------------------------------------

const PRIORITY_RANK: Record<TodoPriority, number> = { high: 0, medium: 1, low: 2 };

/** Stable list order: open items first, then by due date (soonest first,
 * undated last), then by priority, then by creation. Completed items sink to
 * the bottom, most-recently-completed first. Pure — callers pass a copy. */
export function sortTodos(todos: Todo[]): Todo[] {
  return todos.toSorted((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.done && b.done) return (b.completedAt ?? 0) - (a.completedAt ?? 0);
    if (a.dueAt !== b.dueAt) {
      if (a.dueAt === null) return 1;
      if (b.dueAt === null) return -1;
      return a.dueAt - b.dueAt;
    }
    if (a.priority !== b.priority) return PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
    return a.createdAt - b.createdAt;
  });
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function startOfDay(ms: number): number {
  const d = new Date(ms);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Whole-calendar-day delta between two epoch-ms instants (local time), so
 * "due at 11pm tonight" reads as Today, not Overdue. */
function dayDelta(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / MS_PER_DAY);
}

/** Calendar-day semantics, consistent with formatDue and the panel's
 * date-only (local-noon) due dates: an item is overdue only once its due day
 * has fully passed — not the instant its noon timestamp slips behind `now`,
 * which would otherwise paint a "Today" item red all afternoon. */
export function isOverdue(todo: Todo, now: number): boolean {
  return !todo.done && todo.dueAt !== null && startOfDay(todo.dueAt) < startOfDay(now);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/** Human-friendly due label relative to `now`: "Today", "Tomorrow",
 * "Yesterday", a weekday within the next week, else "Jun 25". */
export function formatDue(dueAt: number, now: number = Date.now()): string {
  const delta = dayDelta(now, dueAt);
  if (delta === 0) return "Today";
  if (delta === 1) return "Tomorrow";
  if (delta === -1) return "Yesterday";
  if (delta > 1 && delta < 7) return WEEKDAYS[new Date(dueAt).getDay()] ?? "";
  const d = new Date(dueAt);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}
