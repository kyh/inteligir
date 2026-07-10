import { describe, expect, it } from "vitest";

import { createRealtimeSync, type RealtimeOptions, type StreamHandlers } from "../realtime";

// ---------------------------------------------------------------------------
// Pure-policy tests: the supervisor runs over a manual clock and a scripted
// stream — no timers, no network, no native modules.
// ---------------------------------------------------------------------------

/** Drain chained promise callbacks so async `runSync` chains settle. */
async function drainMicrotasks(): Promise<void> {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
}

/** A manual clock implementing the `schedule` port. `advance` fires due timers
 * in time-then-insertion order, draining microtasks between firings so async
 * `runSync` chains settle deterministically. */
function fakeClock() {
  let now = 0;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();

  function schedule(fn: () => void, ms: number): () => void {
    const id = nextId++;
    timers.set(id, { at: now + ms, fn });
    return () => {
      timers.delete(id);
    };
  }

  async function advance(ms: number): Promise<void> {
    const target = now + ms;
    for (;;) {
      let dueId: number | null = null;
      let dueAt = Infinity;
      for (const [id, timer] of timers) {
        if (
          timer.at <= target &&
          (timer.at < dueAt || (timer.at === dueAt && id < (dueId ?? Infinity)))
        ) {
          dueId = id;
          dueAt = timer.at;
        }
      }
      if (dueId === null) break;
      const due = timers.get(dueId);
      timers.delete(dueId);
      now = dueAt;
      due?.fn();
      await drainMicrotasks();
    }
    now = target;
  }

  return { schedule, advance, drainMicrotasks, pendingTimers: () => timers.size };
}

/** A scripted stream port: records opens/closes, lets tests push change events
 * and drop the connection. */
function fakeStream() {
  let opens = 0;
  let closes = 0;
  let handlers: StreamHandlers | null = null;

  function openStream(h: StreamHandlers): () => void {
    opens += 1;
    handlers = h;
    const mine = h;
    return () => {
      closes += 1;
      if (handlers === mine) handlers = null;
    };
  }

  return {
    openStream,
    emitChange: () => handlers?.onChange(),
    drop: () => {
      const h = handlers;
      handlers = null; // a dropped stream never speaks again
      h?.onEnd();
    },
    opens: () => opens,
    closes: () => closes,
    isOpen: () => handlers !== null,
  };
}

/** A runSync fake that resolves when the test releases it. */
function fakeSync() {
  let runs = 0;
  const releases: (() => void)[] = [];
  let manual = false;

  function runSync(): Promise<unknown> {
    runs += 1;
    if (!manual) return Promise.resolve({ status: "ok" });
    return new Promise((resolve) => {
      releases.push(() => resolve({ status: "ok" }));
    });
  }

  return {
    runSync,
    runs: () => runs,
    holdRuns: () => {
      manual = true;
    },
    release: () => releases.shift()?.(),
  };
}

function harness(options: RealtimeOptions = {}) {
  const clock = fakeClock();
  const stream = fakeStream();
  const sync = fakeSync();
  const supervisor = createRealtimeSync(
    { openStream: stream.openStream, runSync: sync.runSync, schedule: clock.schedule },
    options,
  );
  return { clock, stream, sync, supervisor };
}

describe("createRealtimeSync — debounce", () => {
  it("syncs once, 500ms after a change (trailing edge)", async () => {
    const { clock, stream, sync, supervisor } = harness();
    supervisor.start();
    stream.emitChange();

    await clock.advance(499);
    expect(sync.runs()).toBe(0);

    await clock.advance(1);
    expect(sync.runs()).toBe(1);
  });

  it("folds a burst of changes into one pass, timed from the LAST change", async () => {
    const { clock, stream, sync, supervisor } = harness();
    supervisor.start();

    stream.emitChange();
    await clock.advance(300);
    stream.emitChange(); // resets the window
    await clock.advance(499);
    expect(sync.runs()).toBe(0);

    await clock.advance(1); // 800ms after the first change
    expect(sync.runs()).toBe(1);
  });

  it("a change landing mid-pass queues exactly ONE follow-up pass", async () => {
    const { clock, stream, sync, supervisor } = harness();
    sync.holdRuns();
    supervisor.start();

    stream.emitChange();
    await clock.advance(500);
    expect(sync.runs()).toBe(1); // in flight, held

    // Three more changes while the pass runs — their debounce fires mid-pass.
    stream.emitChange();
    stream.emitChange();
    await clock.advance(500);
    expect(sync.runs()).toBe(1); // still just the held pass

    sync.release();
    await clock.drainMicrotasks();
    expect(sync.runs()).toBe(2); // one queued follow-up, not one per change

    sync.release();
    await clock.drainMicrotasks();
    expect(sync.runs()).toBe(2); // nothing further queued
  });
});

describe("createRealtimeSync — reconnect backoff", () => {
  it("reopens after a drop with exponential backoff, capped", async () => {
    const { clock, stream, supervisor } = harness({
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 4_000,
    });
    supervisor.start();
    expect(stream.opens()).toBe(1);

    stream.drop(); // 1st drop → 1s
    await clock.advance(999);
    expect(stream.opens()).toBe(1);
    await clock.advance(1);
    expect(stream.opens()).toBe(2);

    stream.drop(); // 2nd consecutive → 2s
    await clock.advance(1_999);
    expect(stream.opens()).toBe(2);
    await clock.advance(1);
    expect(stream.opens()).toBe(3);

    stream.drop(); // 3rd → 4s (cap)
    await clock.advance(4_000);
    expect(stream.opens()).toBe(4);

    stream.drop(); // 4th → still 4s (capped)
    await clock.advance(4_000);
    expect(stream.opens()).toBe(5);
  });

  it("a received change resets the backoff to the base delay", async () => {
    const { clock, stream, supervisor } = harness({
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 30_000,
    });
    supervisor.start();

    stream.drop();
    await clock.advance(1_000); // reopened after 1s
    stream.drop();
    await clock.advance(2_000); // reopened after 2s
    expect(stream.opens()).toBe(3);

    stream.emitChange(); // proof of life → backoff resets
    await clock.advance(500); // let the debounced sync fire (irrelevant here)

    stream.drop();
    await clock.advance(1_000); // back to the 1s base, not 4s
    expect(stream.opens()).toBe(4);
  });
});

describe("createRealtimeSync — start/stop lifecycle", () => {
  it("start is idempotent while running", () => {
    const { stream, supervisor } = harness();
    supervisor.start();
    supervisor.start();
    expect(stream.opens()).toBe(1);
  });

  it("stop closes the stream and cancels the pending debounce + reconnect", async () => {
    const { clock, stream, sync, supervisor } = harness();
    supervisor.start();

    stream.emitChange(); // debounce pending
    supervisor.stop();
    expect(stream.closes()).toBe(1);

    await clock.advance(60_000);
    expect(sync.runs()).toBe(0); // debounce cancelled
    expect(stream.opens()).toBe(1); // no reconnect scheduled
    expect(clock.pendingTimers()).toBe(0);
  });

  it("a drop after stop never reconnects", async () => {
    const { clock, stream, supervisor } = harness();
    supervisor.start();
    supervisor.stop();

    stream.drop(); // stale stream speaks after teardown
    await clock.advance(60_000);
    expect(stream.opens()).toBe(1);
  });

  it("stop cancels a scheduled reconnect from an earlier drop", async () => {
    const { clock, stream, supervisor } = harness();
    supervisor.start();
    stream.drop();
    supervisor.stop();

    await clock.advance(60_000);
    expect(stream.opens()).toBe(1);
  });

  it("restart after stop opens a fresh stream and syncs on new changes", async () => {
    const { clock, stream, sync, supervisor } = harness();
    supervisor.start();
    supervisor.stop();
    supervisor.start();
    expect(stream.opens()).toBe(2);

    stream.emitChange();
    await clock.advance(500);
    expect(sync.runs()).toBe(1);
  });

  it("stop is a no-op while already stopped", () => {
    const { stream, supervisor } = harness();
    supervisor.stop();
    expect(stream.closes()).toBe(0);
  });
});
