import { useCallback, useEffect, useMemo, useState } from "react";

import { Button } from "@repo/ui/components/button";
import { Input } from "@repo/ui/components/input";
import { Label } from "@repo/ui/components/label";
import { cn } from "@repo/ui/lib/utils";

import { formatDue, isOverdue, sortTodos, type TodoPriority } from "@/shared/todo";
import { useTodoStore } from "@/renderer/stores/todo-store";

// ---------------------------------------------------------------------------
// Priority presets — pill row mirroring the task panel's schedule pills. Each
// carries the dot color used in the list so the two stay in sync.
// ---------------------------------------------------------------------------

const PRIORITIES: { id: TodoPriority; label: string; dot: string }[] = [
  { id: "high", label: "High", dot: "bg-red-400" },
  { id: "medium", label: "Medium", dot: "bg-amber-400" },
  { id: "low", label: "Low", dot: "bg-muted-foreground/40" },
];

const DOT_BY_PRIORITY: Record<TodoPriority, string> = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-muted-foreground/40",
};

// date <input> speaks "YYYY-MM-DD" in local time; we store epoch ms at local
// noon so day-only due dates never flip across a timezone boundary.
function dateInputToEpoch(value: string): number | null {
  if (!value) return null;
  const ms = new Date(`${value}T12:00:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
}

// ---------------------------------------------------------------------------
// Create-todo form
// ---------------------------------------------------------------------------

function CreateTodoForm({ onDone }: { onDone: () => void }) {
  const createTodo = useTodoStore((s) => s.createTodo);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<TodoPriority>("medium");
  const [due, setDue] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!title.trim()) return;
    setSubmitting(true);
    const ok = await createTodo({
      title: title.trim(),
      priority,
      dueAt: dateInputToEpoch(due),
    });
    setSubmitting(false);
    if (ok) onDone();
  }, [title, priority, due, createTodo, onDone]);

  return (
    <div className="flex flex-col gap-3 border-t border-border pt-3">
      <Input
        placeholder="What needs doing?"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void handleSubmit();
        }}
        autoFocus
        className="text-xs"
      />

      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] text-muted-foreground">Priority</Label>
        <div className="flex flex-wrap gap-1">
          {PRIORITIES.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cn(
                "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] transition-colors",
                priority === p.id
                  ? "bg-active text-foreground"
                  : "text-muted-foreground hover:bg-hover hover:text-foreground",
              )}
              onClick={() => setPriority(p.id)}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", p.dot)} />
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label className="text-[10px] text-muted-foreground">Due (optional)</Label>
        <Input
          type="date"
          value={due}
          onChange={(e) => setDue(e.target.value)}
          className="w-36 text-xs"
        />
      </div>

      <Button onClick={handleSubmit} disabled={submitting || !title.trim()} className="text-xs">
        {submitting ? "Adding..." : "Add"}
      </Button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// To-do panel content
// ---------------------------------------------------------------------------

export function TodoPanel() {
  const todos = useTodoStore((s) => s.todos);
  const init = useTodoStore((s) => s.init);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const clearCompleted = useTodoStore((s) => s.clearCompleted);
  const syncTodos = useTodoStore((s) => s.syncTodos);
  const syncing = useTodoStore((s) => s.syncing);
  const lastSync = useTodoStore((s) => s.lastSync);
  const [creating, setCreating] = useState(false);

  // init fetches the snapshot and subscribes to onTodosUpdated, so items the
  // agent adds/completes appear without a remount.
  useEffect(() => init(), [init]);

  const sorted = useMemo(() => sortTodos(todos), [todos]);
  const now = Date.now();
  const completedCount = useMemo(() => todos.filter((t) => t.done).length, [todos]);

  return (
    <div className="p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium">To Do</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
            onClick={() => void syncTodos()}
            disabled={syncing}
            title="Sync with Google Tasks"
          >
            {syncing ? "syncing…" : "sync"}
          </button>
          <button
            type="button"
            className="text-[10px] text-muted-foreground transition-colors hover:text-foreground"
            onClick={() => setCreating(!creating)}
          >
            {creating ? "cancel" : "+ new"}
          </button>
        </div>
      </div>

      {lastSync && !lastSync.ok && (
        <div className="mb-2 rounded-[10px] bg-hover px-2.5 py-2 text-[10px] text-muted-foreground">
          Connect Google Tasks in Extensions to sync your list.
        </div>
      )}

      {sorted.length === 0 && !creating && (
        <div className="py-4 text-center text-[10px] text-muted-foreground">Nothing to do yet</div>
      )}

      {sorted.length > 0 && (
        <div className="flex flex-col gap-0.5">
          {sorted.map((todo) => {
            const overdue = isOverdue(todo, now);
            return (
              <div
                key={todo.id}
                className="group flex items-center gap-2 rounded-[10px] px-2 py-1.5 text-xs hover:bg-hover"
              >
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={todo.done}
                  className={cn(
                    "flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    todo.done
                      ? "border-green-400 bg-green-400 text-white"
                      : "border-muted-foreground/40 hover:border-foreground",
                  )}
                  onClick={() => void toggleTodo(todo.id)}
                  title={todo.done ? "Reopen" : "Complete"}
                >
                  {todo.done && (
                    <svg viewBox="0 0 12 12" className="h-2.5 w-2.5" fill="none">
                      <path
                        d="M2.5 6.5L5 9l4.5-5"
                        stroke="currentColor"
                        strokeWidth="1.75"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>

                {!todo.done && (
                  <span
                    className={cn(
                      "h-1.5 w-1.5 shrink-0 rounded-full",
                      DOT_BY_PRIORITY[todo.priority],
                    )}
                    title={`${todo.priority} priority`}
                  />
                )}

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate",
                    todo.done && "text-muted-foreground line-through",
                  )}
                  title={todo.notes || todo.title}
                >
                  {todo.title}
                </span>

                {todo.dueAt !== null && !todo.done && (
                  <span
                    className={cn(
                      "shrink-0 text-[10px]",
                      overdue ? "text-red-400" : "text-muted-foreground",
                    )}
                  >
                    {formatDue(todo.dueAt, now)}
                  </span>
                )}

                <button
                  type="button"
                  className="shrink-0 text-[10px] text-muted-foreground/40 opacity-0 transition-opacity hover:text-destructive-foreground group-hover:opacity-100"
                  onClick={() => void deleteTodo(todo.id)}
                  title="Delete"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
      )}

      {completedCount > 0 && (
        <button
          type="button"
          className="mt-2 text-[10px] text-muted-foreground/70 transition-colors hover:text-foreground"
          onClick={() => void clearCompleted()}
        >
          Clear {completedCount} completed
        </button>
      )}

      {creating && <CreateTodoForm onDone={() => setCreating(false)} />}
    </div>
  );
}
