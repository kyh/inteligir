import { createCoalescingTimer } from "../coalescing-timer";

// the socket makes sync immediate; this makes it correct when the socket is down.
const POLL_INTERVAL_MS = 60_000;

// scheduled from inside the append's transaction, which is safe because a
// setTimeout callback cannot run until better-sqlite3's synchronous transaction returns.
const PUSH_DEBOUNCE_MS = 1_500;

export interface SyncCadenceArgs {
  /** null disables both timers; absent is the shipping cadence. */
  pollIntervalMs?: number | null;
  canRun(): boolean;
  run(): void;
}

export interface SyncCadence {
  armPoll(): void;
  scheduleDrain(): void;
  clear(): void;
}

export function createSyncCadence(args: SyncCadenceArgs): SyncCadence {
  const pollIntervalMs = args.pollIntervalMs === undefined ? POLL_INTERVAL_MS : args.pollIntervalMs;
  let pollTimer: ReturnType<typeof setInterval> | null = null;
  const drain = createCoalescingTimer(PUSH_DEBOUNCE_MS, () => {
    args.run();
  });

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
      if (!args.canRun() || pollIntervalMs === null) {
        return;
      }
      drain.arm();
    },

    clear() {
      if (pollTimer !== null) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      drain.clear();
    },
  };
}
