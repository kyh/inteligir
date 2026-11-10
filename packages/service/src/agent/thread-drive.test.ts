// A conversation's drive as both drivers move it: each event's effect in order, and where the
// drive ends. The object and the stepped host apply these effects (`./agent-thread`,
// `../test-support/thread-host`); `./agent-thread.test.ts` drives the loop over them.

import { describe, expect, it } from "vitest";

import { cutCall, cutOf, nextDrive, RESTING } from "./thread-drive";
import type { Drive, DriveEffect, DriveEvent } from "./thread-drive";

const KICK: DriveEvent = { kind: "kick" };
const WAKE: DriveEvent = { kind: "wake" };
const PURGE: DriveEvent = { kind: "purge" };
const THREW: DriveEvent = { kind: "threw" };
const CONTINUE: DriveEvent = { kind: "stepped", result: "continue" };
const IDLE: DriveEvent = { kind: "stepped", result: "idle" };
const PAUSED: DriveEvent = { kind: "stepped", result: "paused" };
const LATER: DriveEvent = { kind: "stepped", result: "later" };

// every event's effect in turn, from `from`, and the drive they leave
const driven = (events: readonly DriveEvent[], from: Drive = RESTING) => {
  let drive = from;
  const effects: DriveEffect[] = [];
  for (const event of events) {
    const { drive: after, effect } = nextDrive(drive, event);
    drive = after;
    effects.push(effect);
  }
  return { drive, effects };
};

describe("a conversation's drive", () => {
  it("starts on its job, steps while a step goes on, and rests when it rests", () => {
    expect(driven([KICK, CONTINUE, CONTINUE, IDLE])).toStrictEqual({
      drive: RESTING,
      effects: ["start", "step", "step", "rest"],
    });
    expect(driven([KICK, PAUSED]).effects).toStrictEqual(["start", "rest"]);
  });

  it("steps exactly once more for something new asked while it steps", () => {
    expect(driven([KICK, WAKE, IDLE, IDLE])).toStrictEqual({
      drive: RESTING,
      effects: ["start", "push", "step", "rest"],
    });
    expect(driven([KICK, WAKE, WAKE, PAUSED, PAUSED]).effects).toStrictEqual([
      "start",
      "push",
      "push",
      "step",
      "rest",
    ]);
  });

  it("pushes its job for something new while it rests, and starts once that job comes due", () => {
    expect(driven([WAKE, KICK]).effects).toStrictEqual(["push", "start"]);
  });

  it("watches the reply for silence when its job comes due while it steps", () => {
    expect(driven([KICK, KICK])).toStrictEqual({
      drive: { again: false, kind: "driving" },
      effects: ["start", "watch"],
    });
  });

  it("leaves a retry to the job a step timed, and times one after a step that threw", () => {
    expect(driven([KICK, LATER])).toStrictEqual({ drive: RESTING, effects: ["start", "none"] });
    expect(driven([KICK, THREW])).toStrictEqual({ drive: RESTING, effects: ["start", "retry"] });
  });

  it("takes no step's result while it rests", () => {
    expect(driven([CONTINUE, THREW])).toStrictEqual({ drive: RESTING, effects: ["none", "none"] });
  });

  it("purges once, mid-step or resting, and then nothing moves it", () => {
    expect(driven([KICK, PURGE, CONTINUE, KICK, WAKE, THREW, PURGE])).toStrictEqual({
      drive: { kind: "purged" },
      effects: ["start", "purge", "none", "none", "none", "none", "none"],
    });
    expect(driven([PURGE, KICK]).effects).toStrictEqual(["purge", "none"]);
  });
});

describe("a cut call", () => {
  it("says why it was cut, and nothing while it runs or for an abort of no cut", () => {
    const stopped = new AbortController();
    expect(cutOf(stopped.signal)).toBeNull();
    cutCall(stopped, "stopped");
    expect(cutOf(stopped.signal)).toBe("stopped");
    const purged = new AbortController();
    cutCall(purged, "purged");
    expect(cutOf(purged.signal)).toBe("purged");
    const other = new AbortController();
    other.abort(new Error("Not a cut."));
    expect(cutOf(other.signal)).toBeNull();
  });
});
