import { describe, expect, it } from "vitest";

import { createRealtimeSync, type RealtimeOptions, type StreamHandlers } from "../realtime";

// ---------------------------------------------------------------------------
// Pure-policy tests: the supervisor runs over a manual clock and a scripted
// stream — no timers, no network, no native modules. Debounce + pass
// serialization are the SyncEngine's (tested in @repo/domain); the supervisor
// owns only the stream lifecycle + reconnect backoff.
// ---------------------------------------------------------------------------

/** A manual clock implementing the `schedule` port. `advance` fires due timers
 * in time-then-insertion order. */
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

  function advance(ms: number): void {
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
    }
    now = target;
  }

  return { schedule, advance, pendingTimers: () => timers.size };
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

function harness(options: RealtimeOptions = {}) {
  const clock = fakeClock();
  const stream = fakeStream();
  let kicks = 0;
  const supervisor = createRealtimeSync(
    {
      openStream: stream.openStream,
      scheduleSync: () => {
        kicks += 1;
      },
      schedule: clock.schedule,
    },
    options,
  );
  return { clock, stream, supervisor, kicks: () => kicks };
}

describe("createRealtimeSync — change handling", () => {
  it("kicks scheduleSync once per received change (debounce is the engine's)", () => {
    const { stream, supervisor, kicks } = harness();
    supervisor.start();

    stream.emitChange();
    expect(kicks()).toBe(1);
    stream.emitChange();
    stream.emitChange();
    expect(kicks()).toBe(3);
  });

  it("ignores changes from a stream that was already replaced/stopped", () => {
    const { stream, supervisor, kicks } = harness();
    supervisor.start();
    supervisor.stop();

    stream.emitChange(); // stale stream speaks after teardown
    expect(kicks()).toBe(0);
  });
});

describe("createRealtimeSync — reconnect backoff", () => {
  it("reopens after a drop with exponential backoff, capped", () => {
    const { clock, stream, supervisor } = harness({
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 4_000,
    });
    supervisor.start();
    expect(stream.opens()).toBe(1);

    stream.drop(); // 1st drop → 1s
    clock.advance(999);
    expect(stream.opens()).toBe(1);
    clock.advance(1);
    expect(stream.opens()).toBe(2);

    stream.drop(); // 2nd consecutive → 2s
    clock.advance(1_999);
    expect(stream.opens()).toBe(2);
    clock.advance(1);
    expect(stream.opens()).toBe(3);

    stream.drop(); // 3rd → 4s (cap)
    clock.advance(4_000);
    expect(stream.opens()).toBe(4);

    stream.drop(); // 4th → still 4s (capped)
    clock.advance(4_000);
    expect(stream.opens()).toBe(5);
  });

  it("a received change resets the backoff to the base delay", () => {
    const { clock, stream, supervisor } = harness({
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 30_000,
    });
    supervisor.start();

    stream.drop();
    clock.advance(1_000); // reopened after 1s
    stream.drop();
    clock.advance(2_000); // reopened after 2s
    expect(stream.opens()).toBe(3);

    stream.emitChange(); // proof of life → backoff resets

    stream.drop();
    clock.advance(1_000); // back to the 1s base, not 4s
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

  it("stop closes the stream and leaves no pending work", () => {
    const { clock, stream, supervisor, kicks } = harness();
    supervisor.start();

    supervisor.stop();
    expect(stream.closes()).toBe(1);

    clock.advance(60_000);
    expect(kicks()).toBe(0);
    expect(stream.opens()).toBe(1); // no reconnect scheduled
    expect(clock.pendingTimers()).toBe(0);
  });

  it("a drop after stop never reconnects", () => {
    const { clock, stream, supervisor } = harness();
    supervisor.start();
    supervisor.stop();

    stream.drop(); // stale stream speaks after teardown
    clock.advance(60_000);
    expect(stream.opens()).toBe(1);
  });

  it("stop cancels a scheduled reconnect from an earlier drop", () => {
    const { clock, stream, supervisor } = harness();
    supervisor.start();
    stream.drop();
    supervisor.stop();

    clock.advance(60_000);
    expect(stream.opens()).toBe(1);
    expect(clock.pendingTimers()).toBe(0);
  });

  it("restart after stop opens a fresh stream, backoff reset, changes kick again", () => {
    const { clock, stream, supervisor, kicks } = harness({
      reconnectBaseMs: 1_000,
      reconnectMaxMs: 30_000,
    });
    supervisor.start();
    stream.drop();
    clock.advance(1_000);
    stream.drop(); // progression now at 2s
    supervisor.stop();
    supervisor.start();
    expect(stream.opens()).toBe(3);

    stream.emitChange();
    expect(kicks()).toBe(1);

    stream.drop();
    clock.advance(1_000); // base delay again — the restart reset the backoff
    expect(stream.opens()).toBe(4);
  });

  it("stop is a no-op while already stopped", () => {
    const { stream, supervisor } = harness();
    supervisor.stop();
    expect(stream.closes()).toBe(0);
  });
});
