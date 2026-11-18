// `after(fn)` calls `fn` only once the response has closed. Work that waits for the response goes to
// `after()` itself (`scheduleBackground`); work that must start with the request starts at once
// (`startBackground`) and `after()` is handed a callback awaiting it, which keeps the function alive
// until it settles and what it schedules with `after()` alive too, as dataembed's does.
import { after } from "next/server";

const guarded = (task: () => Promise<void>, label: string) => async (): Promise<void> => {
  try {
    await task();
  } catch (error) {
    console.error(`[background] ${label} failed`, error);
  }
};

export const scheduleBackground = (task: () => Promise<void>, label: string): void => {
  const run = guarded(task, label);
  try {
    after(run);
  } catch {
    // outside a request, a script's or a suite's, `after` throws before scheduling anything, so the
    // task runs detached
    void run();
  }
};

export const startBackground = (task: () => Promise<void>, label: string): void => {
  const running = guarded(task, label)();
  try {
    after(async () => {
      await running;
    });
  } catch {
    // outside a request, a script's or a suite's, `after` throws and the task simply runs on
  }
};
