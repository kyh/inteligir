import type { ReplicaStatus } from "@repo/library-replica/library-replica";
import { describe, expect, it } from "vitest";

import { syncWords } from "./sync-words";

const CAUGHT_UP: ReplicaStatus = {
  cursor: 4,
  failure: null,
  parked: [],
  syncing: false,
  unsent: 0,
};

describe("what the rail says of the library", () => {
  it("says it is up to date once nothing is left to send or fetch", () => {
    expect(syncWords(CAUGHT_UP, true)).toStrictEqual({ text: "Up to date", tone: "quiet" });
  });

  it("counts what it is still sending, and says it is updating while it pulls", () => {
    expect(syncWords({ ...CAUGHT_UP, unsent: 2 }, true).text).toBe("Sending 2 changes…");
    expect(syncWords({ ...CAUGHT_UP, syncing: true }, true).text).toBe("Updating…");
  });

  it("waits for a connection when the browser has none or the library can't be reached", () => {
    expect(syncWords({ ...CAUGHT_UP, unsent: 1 }, false)).toStrictEqual({
      text: "Waiting for a connection to send 1 change",
      tone: "waiting",
    });
    const unreachable = { kind: "unreachable" as const, message: "Your library can't be reached." };
    expect(syncWords({ ...CAUGHT_UP, failure: unreachable }, true).tone).toBe("waiting");
  });

  it("says the sign-in ended, whatever else stands, since nothing more can go", () => {
    const failure = { end: "signed-out" as const, kind: "session" as const };
    expect(syncWords({ ...CAUGHT_UP, failure }, true)).toStrictEqual({
      text: "Signed out. Sign in again to go on",
      tone: "attention",
    });
    const parked = [{ itemIds: ["a"], reason: "Too large.", seq: 3 }];
    expect(syncWords({ ...CAUGHT_UP, failure, parked, unsent: 1 }, false).text).toBe(
      "Signed out. Sign in again to go on",
    );
  });

  it("says to update a build the cloud refuses, and what waits for it", () => {
    const failure = { end: "outdated" as const, kind: "session" as const };
    expect(syncWords({ ...CAUGHT_UP, failure }, true)).toStrictEqual({
      text: "Update Inteligir to stay up to date",
      tone: "attention",
    });
    expect(syncWords({ ...CAUGHT_UP, failure, unsent: 3 }, true).text).toBe(
      "Update Inteligir to send 3 changes",
    );
  });

  it("never says it is up to date while every pass is failing", () => {
    const stuck = { text: "Your library couldn't update. Trying again soon", tone: "attention" };
    const fault = { kind: "fault" as const, message: "no such table: items" };
    expect(syncWords({ ...CAUGHT_UP, failure: fault }, true)).toStrictEqual(stuck);
    expect(syncWords({ ...CAUGHT_UP, failure: fault, unsent: 2 }, true)).toStrictEqual(stuck);
    const malformed = { kind: "malformed" as const, message: "Your library couldn't take this." };
    expect(syncWords({ ...CAUGHT_UP, failure: malformed }, true)).toStrictEqual(stuck);
  });

  it("puts a refused change ahead of everything but the sign-in", () => {
    const parked = [{ itemIds: ["a"], reason: "Too large.", seq: 3 }];
    expect(syncWords({ ...CAUGHT_UP, parked, unsent: 1 }, false)).toStrictEqual({
      text: "1 change not saved",
      tone: "attention",
    });
  });
});
