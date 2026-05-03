import { create } from "zustand";

import type { CreateTaskParams, Task } from "@/shared/task";
import { getBridge } from "@/renderer/lib/bridge";

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

type TaskStore = {
  tasks: Task[];
  loading: boolean;

  fetchTasks: () => void;
  createTask: (params: CreateTaskParams) => Promise<boolean>;
  toggleTask: (id: string) => void;
  deleteTask: (id: string) => void;
};

export const useTaskStore = create<TaskStore>((set) => ({
  tasks: [],
  loading: false,

  fetchTasks: () => {
    const bridge = getBridge();
    if (!bridge) return;
    set({ loading: true });
    void bridge
      .listTasks()
      .then((result) => set({ tasks: result.tasks }))
      .catch(() => {})
      .finally(() => set({ loading: false }));
  },

  createTask: async (params: CreateTaskParams) => {
    const bridge = getBridge();
    if (!bridge) return false;
    try {
      const result = await bridge.createTask(params);
      set((s) => ({ tasks: [...s.tasks, result.task] }));
      return true;
    } catch {
      return false;
    }
  },

  toggleTask: (id: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    // Optimistic update
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === id ? { ...t, enabled: !t.enabled } : t)),
    }));
    void bridge.toggleTask(id).catch(() => {});
  },

  deleteTask: (id: string) => {
    const bridge = getBridge();
    if (!bridge) return;
    // Optimistic update
    set((s) => ({ tasks: s.tasks.filter((t) => t.id !== id) }));
    void bridge.deleteTask(id).catch(() => {});
  },
}));
