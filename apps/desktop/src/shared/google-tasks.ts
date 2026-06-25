// Pure logic for two-way sync between local todos and Google Tasks. No I/O:
// the main-side sync service (main/todos/google-tasks-sync.ts) fetches/pushes
// via the executor and calls planSync to decide what changes where.
//
// Reconciliation is last-write-wins, keyed by googleTaskId:
//   - linked local + remote present → newer side wins (local.updatedAt vs
//     remote.updated)
//   - linked local + remote gone     → remote deleted it → delete local
//   - unlinked local                  → export (create remote, then link)
//   - remote with no local match      → import (create local)
// Priority has no Google Tasks equivalent, so it's local-only: preserved on a
// remote-wins update, defaulted to "medium" on import.

import type { Todo, TodoPriority } from "@/shared/todo";

// ---------------------------------------------------------------------------
// Google Tasks shapes
// ---------------------------------------------------------------------------

export type GoogleTask = {
  id: string;
  title: string;
  notes: string;
  status: "needsAction" | "completed";
  /** RFC3339 date (time ignored by Google), or null. */
  due: string | null;
  /** RFC3339 timestamp of the last remote change. */
  updated: string;
  /** RFC3339 completion timestamp, or null. */
  completed: string | null;
};

/** Fields written when creating/updating a remote task. */
export type GoogleTaskWriteFields = {
  title: string;
  notes: string;
  status: "needsAction" | "completed";
  /** Omitted when there's no due date. */
  due?: string;
};

export type SyncPlan = {
  /** Brand-new local todos from remote tasks with no local match. applySync
   * adds these (by a fresh id), so they're separated from updates. */
  localImports: Todo[];
  /** Remote-wins rewrites of EXISTING local rows (matched by id). applySync
   * only applies these to rows still present, never resurrecting a deleted one. */
  localUpdates: Todo[];
  /** Local todo ids to delete (remote removed them). */
  localDeletes: string[];
  /** Unlinked local todos to create remotely; link by `localId` afterward. */
  remoteCreates: { localId: string; fields: GoogleTaskWriteFields }[];
  /** Linked local todos whose local edit is newer — push to the remote task. */
  remoteUpdates: { googleTaskId: string; fields: GoogleTaskWriteFields }[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

// ---------------------------------------------------------------------------
// Date conversions — Google Tasks `due` is date-only. Pin to local noon on the
// way in (matching the To-Do panel) so a day never flips across a timezone.
// ---------------------------------------------------------------------------

export function dueToEpoch(due: string | null): number | null {
  if (!due) return null;
  const ms = new Date(`${due.slice(0, 10)}T12:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

function epochToDue(ms: number | null): string | undefined {
  if (ms === null) return undefined;
  const d = new Date(ms);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  // Date-only RFC3339; Google ignores the time component.
  return `${yyyy}-${mm}-${dd}T00:00:00.000Z`;
}

// ---------------------------------------------------------------------------
// Parsing + mapping
// ---------------------------------------------------------------------------

/** Parse Google Tasks `tasks.list` items, dropping any without an id/updated.
 * Hidden/deleted tasks (Google keeps tombstones for completed items) are the
 * caller's concern — we pass through whatever the API returned. */
export function parseGoogleTasks(items: unknown): GoogleTask[] {
  if (!Array.isArray(items)) return [];
  const out: GoogleTask[] = [];
  for (const raw of items) {
    if (!isRecord(raw)) continue;
    const id = str(raw["id"]);
    const updated = str(raw["updated"]);
    if (!id || !updated) continue;
    out.push({
      id,
      title: str(raw["title"]),
      notes: str(raw["notes"]),
      status: raw["status"] === "completed" ? "completed" : "needsAction",
      due: typeof raw["due"] === "string" ? raw["due"] : null,
      updated,
      completed: typeof raw["completed"] === "string" ? raw["completed"] : null,
    });
  }
  return out;
}

export function todoToWriteFields(todo: Todo): GoogleTaskWriteFields {
  const due = epochToDue(todo.dueAt);
  return {
    title: todo.title,
    notes: todo.notes,
    status: todo.done ? "completed" : "needsAction",
    ...(due !== undefined ? { due } : {}),
  };
}

/** Build a local todo from a remote task (import), or apply remote fields onto
 * an existing local todo (remote-wins update). `base` carries the local-only
 * fields to preserve (id, priority, createdAt). */
function applyRemote(task: GoogleTask, base: Pick<Todo, "id" | "priority" | "createdAt">): Todo {
  const done = task.status === "completed";
  return {
    id: base.id,
    title: task.title,
    notes: task.notes,
    done,
    priority: base.priority,
    dueAt: dueToEpoch(task.due),
    createdAt: base.createdAt,
    updatedAt: Date.parse(task.updated) || Date.now(),
    // `|| Date.now()` also catches a malformed `completed` string (Date.parse →
    // NaN, which is falsy) so completedAt is always a valid epoch.
    completedAt: done ? Date.parse(task.completed ?? "") || Date.now() : null,
    googleTaskId: task.id,
  };
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

const DEFAULT_PRIORITY: TodoPriority = "medium";

export function planSync(
  local: Todo[],
  remote: GoogleTask[],
  now: number,
  newId: () => string,
): SyncPlan {
  const plan: SyncPlan = {
    localImports: [],
    localUpdates: [],
    localDeletes: [],
    remoteCreates: [],
    remoteUpdates: [],
  };
  const remoteById = new Map(remote.map((t) => [t.id, t]));
  const matched = new Set<string>();

  for (const todo of local) {
    if (todo.googleTaskId === null) {
      // Never exported — create it remotely; the service links it afterward.
      plan.remoteCreates.push({ localId: todo.id, fields: todoToWriteFields(todo) });
      continue;
    }
    const task = remoteById.get(todo.googleTaskId);
    if (!task) {
      // Linked, but gone remotely — treat as a remote delete.
      plan.localDeletes.push(todo.id);
      continue;
    }
    matched.add(task.id);
    const remoteUpdated = Date.parse(task.updated) || 0;
    if (todo.updatedAt > remoteUpdated) {
      plan.remoteUpdates.push({ googleTaskId: task.id, fields: todoToWriteFields(todo) });
    } else {
      plan.localUpdates.push(applyRemote(task, todo));
    }
  }

  // Remote tasks with no local counterpart — import as new local todos.
  for (const task of remote) {
    if (matched.has(task.id)) continue;
    plan.localImports.push(
      applyRemote(task, { id: newId(), priority: DEFAULT_PRIORITY, createdAt: now }),
    );
  }

  return plan;
}
