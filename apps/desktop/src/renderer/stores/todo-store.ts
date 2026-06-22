import { create } from "zustand";
import { toast } from "@repo/ui/components/sonner";

import type { CreateTodoParams, Todo, TodoSyncResult, UpdateTodoParams } from "@/shared/todo";
import { getBridge } from "@/renderer/lib/bridge";

type TodoStore = {
  todos: Todo[];
  loading: boolean;
  error: string | null;
  syncing: boolean;
  lastSync: TodoSyncResult | null;

  /**
   * Fetch the current snapshot AND subscribe to the main-side push channel
   * (onTodosUpdated) so agent/sync mutations show up live instead of only on
   * remount. Returns an unsubscribe for the mount's cleanup.
   */
  init: () => () => void;
  fetchTodos: () => void;
  createTodo: (params: CreateTodoParams) => Promise<boolean>;
  updateTodo: (params: UpdateTodoParams) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
  syncTodos: () => Promise<void>;
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : "Unknown error";

// Monotonic snapshot counter. Every push and every optimistic mutation bumps
// it; an in-flight fetch captures the value at request time and only applies
// its (potentially stale) result if nothing newer landed meanwhile — so a slow
// listTodos can't clobber a fresher push/mutation. Module-level because the
// zustand store is a singleton.
let snapshotSeq = 0;

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  error: null,
  syncing: false,
  lastSync: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};
    get().fetchTodos();
    // Each event carries the full snapshot; bumping the sequence invalidates
    // any fetch still in flight so it can't overwrite this newer state.
    return bridge.onTodosUpdated(({ todos }) => {
      snapshotSeq++;
      set({ todos });
    });
  },

  fetchTodos: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const seq = snapshotSeq;
    set({ loading: true, error: null });
    void bridge
      .listTodos()
      // Drop the result if a push or mutation superseded this fetch.
      .then((result) => (seq === snapshotSeq ? set({ todos: result.todos }) : undefined))
      .catch((err: unknown) => {
        set({ error: `Couldn't load to-dos: ${errorMessage(err)}` });
      })
      .finally(() => set({ loading: false }));
  },

  createTodo: async (params) => {
    const bridge = getBridge();
    if (!bridge) return false;
    try {
      const result = await bridge.createTodo(params);
      // The push event may have landed before the invoke resolved (it
      // broadcasts mid-handler) — don't append a duplicate.
      snapshotSeq++;
      set((s) =>
        s.todos.some((t) => t.id === result.todo.id) ? s : { todos: [...s.todos, result.todo] },
      );
      return true;
    } catch (err) {
      toast.error(`Couldn't add to-do: ${errorMessage(err)}`);
      return false;
    }
  },

  updateTodo: async (params) => {
    const bridge = getBridge();
    if (!bridge) return;
    snapshotSeq++;
    set((s) => ({
      todos: s.todos.map((t) => (t.id === params.id ? { ...t, ...stripId(params) } : t)),
    }));
    try {
      await bridge.updateTodo(params);
    } catch (err) {
      // Reconcile from the authoritative main store rather than restoring a
      // captured snapshot, which would discard any push that landed mid-request.
      get().fetchTodos();
      toast.error(`Couldn't update to-do: ${errorMessage(err)}`);
    }
  },

  toggleTodo: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    snapshotSeq++;
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
    try {
      await bridge.toggleTodo(id);
    } catch (err) {
      get().fetchTodos();
      toast.error(`Couldn't toggle to-do: ${errorMessage(err)}`);
    }
  },

  deleteTodo: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    snapshotSeq++;
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
    try {
      await bridge.deleteTodo(id);
    } catch (err) {
      get().fetchTodos();
      toast.error(`Couldn't delete to-do: ${errorMessage(err)}`);
    }
  },

  clearCompleted: async () => {
    const bridge = getBridge();
    if (!bridge) return;
    snapshotSeq++;
    set((s) => ({ todos: s.todos.filter((t) => !t.done) }));
    try {
      await bridge.clearCompletedTodos();
    } catch (err) {
      get().fetchTodos();
      toast.error(`Couldn't clear completed: ${errorMessage(err)}`);
    }
  },

  syncTodos: async () => {
    const bridge = getBridge();
    if (!bridge) return;
    set({ syncing: true });
    try {
      // The sync mutates the main store, which broadcasts onTodosUpdated — the
      // live list updates through that push, so we only record the outcome.
      const result = await bridge.syncTodos();
      set({ lastSync: result });
      if (!result.ok) toast.error(`Sync failed: ${result.error}`);
    } catch (err) {
      const message = errorMessage(err);
      set({ lastSync: { ok: false, error: message } });
      toast.error(`Sync failed: ${message}`);
    } finally {
      set({ syncing: false });
    }
  },
}));

// Drop the `id` from a patch before merging it into the optimistic copy — the
// id already matched, and spreading it back is a no-op we'd rather not imply.
function stripId(params: UpdateTodoParams): Partial<Todo> {
  const { id: _id, ...rest } = params;
  return rest;
}
