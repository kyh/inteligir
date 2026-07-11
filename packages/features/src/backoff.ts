// ---------------------------------------------------------------------------
// Exponential backoff with a cap — the ONE retry-delay policy shared by the
// ws bridge's reconnect supervisor, the ws host's rebind retry, and the
// mobile realtime stream supervisor. Timer mechanics are injected
// (`schedule`) so node, the browser, React Native, and fake-clock tests all
// drive the same code. Isomorphic: no node/react imports.
// ---------------------------------------------------------------------------

/** Schedule `fn` after `ms`; returns a canceller. `setTimeout` in prod. */
export type Schedule = (fn: () => void, ms: number) => () => void;

export type BackoffOptions = {
  /** First delay; doubles per scheduled run. */
  baseMs: number;
  /** Delay ceiling. */
  capMs: number;
  schedule: Schedule;
};

export type Backoff = {
  /** Run `fn` once after the current delay, doubling the next delay. No-op
   * while a run is already pending. */
  schedule: (fn: () => void) => void;
  /** Cancel the pending run (if any); the delay progression is kept. */
  cancel: () => void;
  /** Reset the delay progression to `baseMs` (does not cancel a pending run). */
  reset: () => void;
};

export function createBackoff(options: BackoffOptions): Backoff {
  const { baseMs, capMs, schedule } = options;
  let delayMs = baseMs;
  let cancelPending: (() => void) | null = null;
  return {
    schedule(fn) {
      if (cancelPending !== null) return;
      const delay = delayMs;
      delayMs = Math.min(delayMs * 2, capMs);
      cancelPending = schedule(() => {
        cancelPending = null;
        fn();
      }, delay);
    },
    cancel() {
      cancelPending?.();
      cancelPending = null;
    },
    reset() {
      delayMs = baseMs;
    },
  };
}

/** The prod `Schedule`: plain `setTimeout`/`clearTimeout`. */
export const timeoutSchedule: Schedule = (fn, ms) => {
  const timer = setTimeout(fn, ms);
  return () => clearTimeout(timer);
};
