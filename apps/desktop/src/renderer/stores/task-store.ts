import { create } from "zustand";
import { toast } from "@repo/ui/components/sonner";

import type { CreateTaskParams, Task } from "@/shared/task";
import { getBridge } from "@/renderer/lib/bridge";

type TaskStore = {
  tasks: Task[];
  loading: boolean;
  error: string | null;

  /**
   * Fetch the current snapshot AND subscribe to the main-side push channel
   * (onTasksUpdated) so agent/scheduler mutations show up live instead of
   * only on remount. Returns an unsubscribe for the mount's cleanup.
   */
  init: () => () => void;
  fetchTasks: () => void;
  createTask: (params: CreateTaskParams) => Promise<boolean>;
  toggleTask: (id: string) => Promise<void>;
  deleteTask: (id: string) => Promise<void>;
};

const errorMessage = (err: unknown): string =>
  err instanceof Error ? err.message : "Unknown error";

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  loading: false,
  error: null,

  init: () => {
    const bridge = getBridge();
    if (!bridge) return () => {};
    get().fetchTasks();
    // Push wins over any in-flight fetch ordering concerns: each event
    // carries the full snapshot, so applying it is idempotent.
    return bridge.onTasksUpdated(({ tasks }) => set({ tasks }));
  },

  fetchTasks: () => {
    const bridge = getBridge();
    if (!bridge) return;
    set({ loading: true, error: null });
    void bridge
      .listTasks()
      .then((result) => set({ tasks: result.tasks }))
      .catch((err: unknown) => {
        set({ error: `Couldn't load tasks: ${errorMessage(err)}` });
      })
      .finally(() => set({ loading: false }));
  },

  createTask: async (params) => {
    const bridge = getBridge();
    if (!bridge) return false;
    try {
      const result = await bridge.createTask(params);
      // The push event for this mutation may have landed before the invoke
      // resolved (it broadcasts mid-handler) — don't append a duplicate.
      set((s) =>
        s.tasks.some((t) => t.id === result.task.id) ? s : { tasks: [...s.tasks, result.task] },
      );
      return true;
    } catch (err) {
      toast.error(`Couldn't create task: ${errorMessage(err)}`);
      return false;
    }
  },

  toggleTask: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    const before = get().tasks;
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    }));
    try {
      await bridge.toggleTask(id);
    } catch (err) {
      set({ tasks: before });
      toast.error(`Couldn't toggle task: ${errorMessage(err)}`);
    }
  },

  deleteTask: async (id) => {
    const bridge = getBridge();
    if (!bridge) return;
    const before = get().tasks;
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    try {
      await bridge.deleteTask(id);
    } catch (err) {
      set({ tasks: before });
      toast.error(`Couldn't delete task: ${errorMessage(err)}`);
    }
  },
}));
