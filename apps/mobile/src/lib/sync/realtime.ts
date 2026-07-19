// ---------------------------------------------------------------------------
// Realtime stream supervisor — the PURE policy keeping the SSE change
// subscription alive. The sync work itself (debounce, pass serialization,
// status) is the SyncEngine's (driven through the injected `scheduleSync`);
// this owns ONLY what the engine doesn't:
//
//   1. a change event kicks one engine-debounced sync (`scheduleSync`).
//   2. a dropped stream is REOPENED with exponential backoff (default
//      1s → 2s → 4s … capped at 30s); any received change resets the backoff,
//      since a live frame is proof the connection works.
//   3. `stop()` tears everything down — stream + pending reconnect — and a
//      stale stream's callbacks can never act after it.
//
// Ports are injected so tests drive it with a fake stream and a fake clock
// (no native modules, no timers). The wiring (expo/fetch SSE port, AppState
// foreground/background, the real engine) lives in ./realtime-manager.ts.
// ---------------------------------------------------------------------------

import { createBackoff } from "@repo/bridge/backoff";

/** Cancel a timer scheduled through `RealtimePorts.schedule`. */
type CancelTimer = () => void;

/** Close an open change stream. */
type CloseStream = () => void;

export type StreamHandlers = {
  /** A change was committed on the coordinator by another client. */
  readonly onChange: () => void;
  /** The stream ended on its own (drop/server close) — NOT via the closer. */
  readonly onEnd: () => void;
};

export type RealtimePorts = {
  /** Open the SSE change stream; returns its closer. */
  readonly openStream: (handlers: StreamHandlers) => CloseStream;
  /** Kick one debounced sync pass (the engine's `scheduleSync` in prod). */
  readonly scheduleSync: () => void;
  /** Schedule `fn` after `ms`; returns a canceller. `setTimeout` in prod. */
  readonly schedule: (fn: () => void, ms: number) => CancelTimer;
};

export type RealtimeOptions = {
  /** First reconnect delay after a drop; doubles per consecutive drop. Default 1000. */
  readonly reconnectBaseMs?: number;
  /** Reconnect delay ceiling. Default 30000. */
  readonly reconnectMaxMs?: number;
};

export type RealtimeSync = {
  /** Open the stream and reset the backoff. Idempotent while running. */
  readonly start: () => void;
  /** Close the stream and cancel all pending work. Idempotent while stopped. */
  readonly stop: () => void;
};

export function createRealtimeSync(
  ports: RealtimePorts,
  options: RealtimeOptions = {},
): RealtimeSync {
  const backoff = createBackoff({
    baseMs: options.reconnectBaseMs ?? 1_000,
    capMs: options.reconnectMaxMs ?? 30_000,
    schedule: ports.schedule,
  });

  let started = false;
  let closeStream: CloseStream | null = null;
  /** Bumped on every (re)open and on stop — a stale stream's callbacks see a
   * mismatched generation and become no-ops. */
  let generation = 0;

  function open(): void {
    generation += 1;
    const gen = generation;
    closeStream = ports.openStream({
      onChange: () => {
        if (gen !== generation || !started) return;
        backoff.reset(); // a live frame proves the connection works
        ports.scheduleSync();
      },
      onEnd: () => {
        if (gen !== generation || !started) return;
        closeStream = null;
        backoff.schedule(() => {
          if (started) open();
        });
      },
    });
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      backoff.reset();
      open();
    },
    stop(): void {
      if (!started) return;
      started = false;
      generation += 1; // invalidate any in-flight stream callbacks
      closeStream?.();
      closeStream = null;
      backoff.cancel();
      backoff.reset();
    },
  };
}
