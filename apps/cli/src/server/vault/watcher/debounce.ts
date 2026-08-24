// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

interface DebouncedCallbackSchedulerArgs {
  debounceMs: number;
  /** A busy burst keeps resetting the quiet timer; this caps how long it can. */
  maxWaitMs: number;
  onFlush: () => void;
}

export interface DebouncedCallbackScheduler {
  dispose: () => void;
  flush: () => void;
  schedule: () => void;
}

export function createDebouncedCallbackScheduler(
  args: DebouncedCallbackSchedulerArgs,
): DebouncedCallbackScheduler {
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;

  const clearTimers = () => {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer !== null) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  };

  const flush = () => {
    clearTimers();
    args.onFlush();
  };

  return {
    dispose: clearTimers,
    flush,
    schedule: () => {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
      }
      debounceTimer = setTimeout(flush, args.debounceMs);
      if (maxWaitTimer === null) {
        maxWaitTimer = setTimeout(flush, args.maxWaitMs);
      }
    },
  };
}
