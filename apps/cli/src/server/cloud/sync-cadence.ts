// One responsibility: the CADENCE — the fallback poll that makes sync CORRECT
// when the socket is down, and the push debounce that turns a streaming
// turn's burst of appends into one batch. Neither timer is ever the reason
// this process stays alive, and neither fires a pass unless the runtime says
// one may run (`canRun`) — the gate every session transition flips.

/** The fallback cadence. The socket is what makes sync feel immediate; this is
 *  what makes it CORRECT when the socket is down, so it is deliberately slow. */
const POLL_INTERVAL_MS = 60_000;

/**
 * How long a local append waits before its pass runs. A streaming turn appends
 * thousands of events, and a pass per event would be a request per token; a
 * short window turns the burst into one batch. Scheduled from inside the
 * append's own transaction, which is safe precisely because a `setTimeout`
 * callback cannot run until better-sqlite3's synchronous transaction has
 * returned — so the pass always sees committed rows.
 */
const PUSH_DEBOUNCE_MS = 1_500;

export interface SyncCadenceArgs {
  /** null disables the poll timer and the push debounce — what a
   *  deterministic suite needs. Absent is the shipping cadence. */
  pollIntervalMs?: number | null;
  /** Whether a pass may run at all right now. */
  canRun(): boolean;
  run(): void;
}

export interface SyncCadence {
  /** Start the poll, once; a later call while it runs is a no-op. */
  armPoll(): void;
  /** A local append landed: run one pass after the debounce window. */
  scheduleDrain(): void;
  /** Stop both timers. */
  clear(): void;
}

export function createSyncCadence(args: SyncCadenceArgs): SyncCadence {
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  return {
    armPoll() {
      if (!args.canRun() || pollIntervalMs === null || pollTimer !== null) {
        return;
      }
      pollTimer = setInterval(() => {
        args.run();
      }, pollIntervalMs);
      pollTimer.unref?.();
    },

    scheduleDrain() {
      if (!args.canRun() || pollIntervalMs === null || debounceTimer !== null) {
        return;
      }
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        args.run();
      }, PUSH_DEBOUNCE_MS);
      debounceTimer.unref?.();
    },

    clear() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
    },
  };
}
