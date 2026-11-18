import { after } from "next/server";

const guarded = (task: () => Promise<void>, label: string) => async () => {
  try {
    await task();
  } catch (error) {
    console.error(`[background] ${label} failed`, error);
  }
};

export const scheduleBackground = (task: () => Promise<void>, label: string) => {
  const run = guarded(task, label);

  try {
    after(run);
  } catch {
    void run();
  }
};

export const startBackground = (task: () => Promise<void>, label: string) => {
  const running = guarded(task, label)();

  try {
    after(async () => {
      await running;
    });
  } catch {
    void running;
  }
};
