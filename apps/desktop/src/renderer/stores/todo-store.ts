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
  /** Clear the cached snapshot — call on logout so the next user never sees the
   * previous user's items before their fetch resolves. */
  reset: () => void;
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : "Unknown error";

// Monotonic snapshot counter. Every push and every optimistic mutation bumps
// it; an in-flight fetch captures the value at request time and only applies
// its (potentially stale) result if nothing newer landed meanwhile — so a slow
// listTodos can't clobber a fresher push/mutation. Module-level because the
// zustand store is a singleton.
let snapshotSeq = 0;
// Separate fetch-ordering token so a superseded fetch's loading/error/result
// can't overwrite a newer fetch's state.
let fetchToken = 0;

// One shared push subscription, ref-counted across mounts. Both seeded
// dashboard panels (Agenda + To-Do) call init(); without this each would open
// its own onTodosUpdated listener and run its own initial fetch.
let subscriberCount = 0;
let sharedUnsubscribe: (() => void) | null = null;

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  error: null,
  syncing: false,
  lastSync: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};
    // Only the first mounter opens the listener and runs the initial fetch;
    // later mounters share it. Subscribe BEFORE the fetch so a mutation landing
    // in the window between them isn't missed. Each event carries the full
    // snapshot; bumping the sequence invalidates any fetch still in flight so
    // it can't overwrite this newer state.
    subscriberCount++;
    if (subscriberCount === 1) {
      sharedUnsubscribe = bridge.onTodosUpdated(({ todos }) => {
        snapshotSeq++;
        // Clear any stale load error — a fresh push means the list is current.
        set({ todos, error: null });
      });
      get().fetchTodos();
    }
    return () => {
      subscriberCount--;
      if (subscriberCount === 0) {
        sharedUnsubscribe?.();
        sharedUnsubscribe = null;
      }
    };
  },

  fetchTodos: () => {
    const bridge = getBridge();
    if (!bridge) return;
    const seq = snapshotSeq;
    const token = ++fetchToken;
    set({ loading: true, error: null });
    void bridge
      .listTodos()
      // Apply only if this is still the latest fetch AND no push/mutation
      // superseded it.
      .then((result) =>
        token === fetchToken && seq === snapshotSeq ? set({ todos: result.todos }) : undefined,
      )
      .catch((err: unknown) => {
        if (token === fetchToken) set({ error: `Couldn't load to-dos: ${errorMessage(err)}` });
      })
      .finally(() => {
        if (token === fetchToken) set({ loading: false });
      });
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

  reset: () => {
    // Invalidate any in-flight fetch/push so a late response from the prior
    // session can't repopulate the list.
    snapshotSeq++;
    fetchToken++;
    set({ todos: [], loading: false, error: null, syncing: false, lastSync: null });
  },
}));

// Drop the `id` from a patch before merging it into the optimistic copy — the
// id already matched, and spreading it back is a no-op we'd rather not imply.
function stripId(params: UpdateTodoParams): Partial<Todo> {
  const { id: _id, ...rest } = params;
  return rest;
}
