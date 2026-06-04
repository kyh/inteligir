import { create } from "zustand";
import { toast } from "@repo/ui/components/sonner";

import type { CreateTaskParams, Task } from "@/shared/task";
import { getBridge } from "@/renderer/lib/bridge";

type TaskStore = {
  tasks: Task[];
  loading: boolean;
  error: string | null;

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
      set((s) => ({ tasks: [...s.tasks, result.task] }));
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
