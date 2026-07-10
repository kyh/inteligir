// ---------------------------------------------------------------------------
// Realtime sync supervisor — the PURE policy behind the mobile SSE change
// subscription. It owns exactly three behaviors, over injected ports so tests
// drive it with a fake stream and a fake clock (no native modules, no timers):
//
//   1. change events are DEBOUNCED (default 500ms, trailing edge) into a
//      serialized `runSync` — a burst of edits on another device costs one
//      sync pass, and a pass never overlaps another supervisor-driven pass
//      (a change landing mid-pass queues exactly one follow-up).
//   2. a dropped stream is REOPENED with exponential backoff (default
//      1s → 2s → 4s … capped at 30s); any received change resets the backoff,
//      since a live frame is proof the connection works.
//   3. `stop()` tears everything down — stream, pending debounce, pending
//      reconnect — and a stale stream's callbacks can never act after it.
//
// The wiring (expo/fetch SSE port, AppState foreground/background, the real
// syncOnce) lives in ./realtime-manager.ts.
// ---------------------------------------------------------------------------

/** Cancel a timer scheduled through `RealtimePorts.schedule`. */
export type CancelTimer = () => void;

/** Close an open change stream. */
export type CloseStream = () => void;

export type StreamHandlers = {
  /** A change was committed on the coordinator by another client. */
  readonly onChange: () => void;
  /** The stream ended on its own (drop/server close) — NOT via the closer. */
  readonly onEnd: () => void;
};

export type RealtimePorts = {
  /** Open the SSE change stream; returns its closer. */
  readonly openStream: (handlers: StreamHandlers) => CloseStream;
  /** One sync pass. Must never throw (mirrors `syncOnce`'s errors-as-status). */
  readonly runSync: () => Promise<unknown>;
  /** Schedule `fn` after `ms`; returns a canceller. `setTimeout` in prod. */
  readonly schedule: (fn: () => void, ms: number) => CancelTimer;
};

export type RealtimeOptions = {
  /** Trailing debounce applied to change events before syncing. Default 500. */
  readonly debounceMs?: number;
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
  const debounceMs = options.debounceMs ?? 500;
  const reconnectBaseMs = options.reconnectBaseMs ?? 1_000;
  const reconnectMaxMs = options.reconnectMaxMs ?? 30_000;

  let started = false;
  let closeStream: CloseStream | null = null;
  let cancelDebounce: CancelTimer | null = null;
  let cancelReconnect: CancelTimer | null = null;
  /** Consecutive drops since the last received change (or start). */
  let drops = 0;
  let syncing = false;
  let syncQueued = false;
  /** Bumped on every (re)open and on stop — a stale stream's callbacks see a
   * mismatched generation and become no-ops. */
  let generation = 0;

  function open(): void {
    generation += 1;
    const gen = generation;
    closeStream = ports.openStream({
      onChange: () => {
        if (gen !== generation || !started) return;
        drops = 0; // a live frame proves the connection works
        scheduleSync();
      },
      onEnd: () => {
        if (gen !== generation || !started) return;
        closeStream = null;
        scheduleReconnect();
      },
    });
  }

  function scheduleSync(): void {
    cancelDebounce?.();
    cancelDebounce = ports.schedule(() => {
      cancelDebounce = null;
      void runSerialized();
    }, debounceMs);
  }

  /** Run one pass; changes landing mid-pass fold into ONE follow-up pass. */
  async function runSerialized(): Promise<void> {
    if (syncing) {
      syncQueued = true;
      return;
    }
    syncing = true;
    try {
      do {
        syncQueued = false;
        await ports.runSync();
      } while (syncQueued);
    } finally {
      syncing = false;
    }
  }

  function scheduleReconnect(): void {
    const delay = Math.min(reconnectBaseMs * 2 ** drops, reconnectMaxMs);
    drops += 1;
    cancelReconnect?.();
    cancelReconnect = ports.schedule(() => {
      cancelReconnect = null;
      if (started) open();
    }, delay);
  }

  return {
    start(): void {
      if (started) return;
      started = true;
      drops = 0;
      open();
    },
    stop(): void {
      if (!started) return;
      started = false;
      generation += 1; // invalidate any in-flight stream callbacks
      closeStream?.();
      closeStream = null;
      cancelDebounce?.();
      cancelDebounce = null;
      cancelReconnect?.();
      cancelReconnect = null;
      syncQueued = false;
      drops = 0;
    },
  };
}
