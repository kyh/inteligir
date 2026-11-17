// `after(fn)` calls `fn` only once the response has closed, so work that must start with the request
// starts at once and `after()` is handed a callback awaiting it, which keeps the function alive
// until it settles, as dataembed's does.
import { after } from "next/server";

export const startBackground = (task: () => Promise<void>, label: string): void => {
  const running = (async () => {
    try {
      await task();
    } catch (error) {
      console.error(`[background] ${label} failed`, error);
    }
  })();
  try {
    after(async () => {
      await running;
    });
  } catch {
    // outside a request, a script's or a suite's, `after` throws and the task simply runs on
  }
};
