// Cancellable trailing debounce with a synchronous flush — the one timer
// shape the renderer keeps needing (serialize coalescing, autosave, focus
// refresh). Callers state their delay explicitly; policy constants live at
// the call site, not here.

export type Debouncer = {
  /** Schedule a run, coalescing with any pending one (the timer resets, so a
   * burst of calls yields a single trailing run). */
  schedule(): void;
  /** Run a pending call NOW and clear the timer. No-op when nothing is
   * pending — safe to call unconditionally from flush/close paths. */
  flush(): void;
  /** Drop a pending call WITHOUT running it (the work is stale or about to
   * be superseded). */
  cancel(): void;
};

export function createDebouncer(fn: () => void, delayMs: number): Debouncer {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const clear = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  return {
    schedule(): void {
      clear();
      timer = setTimeout(() => {
        timer = null;
        fn();
      }, delayMs);
    },
    flush(): void {
      if (timer === null) return;
      clear();
      fn();
    },
    cancel(): void {
      clear();
    },
  };
}
