import { create } from "zustand";
import { toast } from "@repo/ui/components/sonner";

import type { CreateTodoParams, Todo, UpdateTodoParams } from "@/shared/todo";
import { getBridge } from "@/renderer/lib/bridge";

type TodoStore = {
  todos: Todo[];
  loading: boolean;
  error: string | null;

  /**
   * Fetch the current snapshot AND subscribe to the main-side push channel
   * (onTodosUpdated) so agent mutations show up live instead of only on
   * remount. Returns an unsubscribe for the mount's cleanup.
   */
  init: () => () => void;
  fetchTodos: () => void;
  createTodo: (params: CreateTodoParams) => Promise<boolean>;
  updateTodo: (params: UpdateTodoParams) => Promise<void>;
  toggleTodo: (id: string) => Promise<void>;
  deleteTodo: (id: string) => Promise<void>;
  clearCompleted: () => Promise<void>;
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : "Unknown error";

export const useTodoStore = create<TodoStore>((set, get) => ({
  todos: [],
  loading: false,
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};
    get().fetchTodos();
    // Each event carries the full snapshot, so applying it is idempotent
    // regardless of in-flight fetch ordering.
    return bridge.onTodosUpdated(({ todos }) => set({ todos }));
  },

  fetchTodos: () => {
    const bridge = getBridge();
    if (!bridge) return;
    set({ loading: true, error: null });
    void bridge
      .listTodos()
      .then((result) => set({ todos: result.todos }))
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
    const before = get().todos;
    set((s) => ({
      todos: s.todos.map((t) => (t.id === params.id ? { ...t, ...stripId(params) } : t)),
    }));
    try {
      await bridge.updateTodo(params);
    } catch (err) {
      set({ todos: before });
      toast.error(`Couldn't update to-do: ${errorMessage(err)}`);
    }
  },

  toggleTodo: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    const before = get().todos;
    set((s) => ({
      todos: s.todos.map((t) => (t.id === id ? { ...t, done: !t.done } : t)),
    }));
    try {
      await bridge.toggleTodo(id);
    } catch (err) {
      set({ todos: before });
      toast.error(`Couldn't toggle to-do: ${errorMessage(err)}`);
    }
  },

  deleteTodo: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    const before = get().todos;
    set((s) => ({ todos: s.todos.filter((t) => t.id !== id) }));
    try {
      await bridge.deleteTodo(id);
    } catch (err) {
      set({ todos: before });
      toast.error(`Couldn't delete to-do: ${errorMessage(err)}`);
    }
  },

  clearCompleted: async () => {
    const bridge = getBridge();
    if (!bridge) return;
    const before = get().todos;
    set((s) => ({ todos: s.todos.filter((t) => !t.done) }));
    try {
      await bridge.clearCompletedTodos();
    } catch (err) {
      set({ todos: before });
      toast.error(`Couldn't clear completed: ${errorMessage(err)}`);
    }
  },
}));

// Drop the `id` from a patch before merging it into the optimistic copy — the
// id already matched, and spreading it back is a no-op we'd rather not imply.
function stripId(params: UpdateTodoParams): Partial<Todo> {
  const { id: _id, ...rest } = params;
  return rest;
}
