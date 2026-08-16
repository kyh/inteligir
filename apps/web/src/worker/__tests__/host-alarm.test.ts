// ---------------------------------------------------------------------------
// The alarm multiplex, driven directly.
//
// One pending alarm serves every deadline this host keeps, so the properties
// that matter are arithmetic rather than behavioural: the earliest concern
// wins, a sweep re-arms for whatever is still owed, and the dirty flag is
// consumed exactly once. Faking the storage is what makes those assertable
// without a socket, an account and a wake.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { HostAlarm, type AlarmConcern, type AlarmStorage } from "../host/host-alarm";

/** The two calls the multiplex makes on `ctx.storage`, with a log. */
function fakeStorage(initial: number | null = null) {
  let armed = initial;
  const setCalls: number[] = [];
  const storage: AlarmStorage = {
    getAlarm: () => Promise.resolve(armed),
    setAlarm: (at) => {
      armed = at instanceof Date ? at.getTime() : at;
      setCalls.push(armed);
      return Promise.resolve();
    },
  };
  return { storage, setCalls, armedAt: () => armed };
}

/** A concern that records its sweeps and answers a fixed due time. */
function concern(name: string, log: string[], dueAt: number | null): AlarmConcern {
  return {
    sweep: () => {
      log.push(name);
    },
    dueAt: () => dueAt,
  };
}

const NOW = 1_000_000;

describe("re-deriving the alarm", () => {
  it("does nothing at all until something says a deadline moved", async () => {
    const { storage, setCalls } = fakeStorage();
    const alarm = new HostAlarm({ storage, now: () => NOW, concerns: [] });

    await alarm.refresh();
    expect(setCalls).toEqual([]);
  });

  it("arms at the EARLIEST deadline any concern holds", async () => {
    const { storage, setCalls } = fakeStorage();
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [
        concern("late", [], NOW + 60_000),
        concern("soon", [], NOW + 500),
        concern("never", [], null),
      ],
    });

    alarm.markDirty();
    await alarm.refresh();
    expect(setCalls).toEqual([NOW + 500]);
  });

  it("never moves an alarm already due sooner", async () => {
    const { storage, setCalls } = fakeStorage(NOW + 100);
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [concern("late", [], NOW + 5_000)],
    });

    alarm.markDirty();
    await alarm.refresh();
    expect(setCalls).toEqual([]);
  });

  it("consumes the flag exactly once", async () => {
    const { storage, setCalls } = fakeStorage();
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [concern("one", [], NOW + 500)],
    });

    alarm.markDirty();
    await alarm.refresh();
    await alarm.refresh();
    expect(setCalls).toEqual([NOW + 500]);
  });

  it("stays total when the storage is gone", async () => {
    const alarm = new HostAlarm({
      storage: {
        getAlarm: () => Promise.reject(new Error("storage went away")),
        setAlarm: () => Promise.reject(new Error("storage went away")),
      },
      now: () => NOW,
      concerns: [concern("one", [], NOW + 500)],
    });

    // Runs in a `finally`: an alarm this object could not arm must never turn a
    // served request into a 500.
    alarm.markDirty();
    await expect(alarm.refresh()).resolves.toBeUndefined();
  });
});

describe("waking", () => {
  it("sweeps every concern in order, then re-arms for what is still owed", async () => {
    const log: string[] = [];
    const { storage, setCalls } = fakeStorage(NOW);
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [
        concern("first", log, null),
        concern("second", log, NOW + 2_000),
        concern("third", log, NOW + 9_000),
      ],
    });

    await alarm.fire();
    expect(log).toEqual(["first", "second", "third"]);
    // Unconditional, unlike `refresh`: the alarm that just fired is spent, so
    // "already due sooner" is never true of it.
    expect(setCalls).toEqual([NOW + 2_000]);
  });

  it("leaves no alarm armed when nothing is owed", async () => {
    const { storage, setCalls } = fakeStorage(NOW);
    const alarm = new HostAlarm({ storage, now: () => NOW, concerns: [concern("idle", [], null)] });

    await alarm.fire();
    expect(setCalls).toEqual([]);
  });

  it("awaits an asynchronous sweep before deriving the next deadline", async () => {
    const log: string[] = [];
    const { storage, setCalls } = fakeStorage(NOW);
    let due: number | null = NOW + 1_000;
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [
        {
          sweep: async () => {
            await Promise.resolve();
            log.push("swept");
            due = null;
          },
          dueAt: () => due,
        },
      ],
    });

    await alarm.fire();
    expect(log).toEqual(["swept"]);
    expect(setCalls).toEqual([]);
  });

  it("goes silent once the account it served is gone", async () => {
    const log: string[] = [];
    const { storage, setCalls } = fakeStorage();
    const alarm = new HostAlarm({
      storage,
      now: () => NOW,
      concerns: [concern("one", log, NOW + 500)],
    });

    alarm.stop();
    alarm.markDirty();
    await alarm.refresh();
    await alarm.fire();
    expect(log).toEqual([]);
    expect(setCalls).toEqual([]);
  });
});
