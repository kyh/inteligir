import type { ReplicaStatus } from "@repo/library-replica/library-replica";
import { describe, expect, it } from "vitest";

import { syncWords } from "./sync-words";

const CAUGHT_UP: ReplicaStatus = {
  bodies: { fetched: 0, total: 0 },
  cursor: 4,
  failure: null,
  head: 4,
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

  it("puts a refused change ahead of everything else", () => {
    const parked = [{ itemIds: ["a"], reason: "Too large.", seq: 3 }];
    expect(syncWords({ ...CAUGHT_UP, parked, unsent: 1 }, false)).toStrictEqual({
      text: "1 change not saved",
      tone: "attention",
    });
  });
});
