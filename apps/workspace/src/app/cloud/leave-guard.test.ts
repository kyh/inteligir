import type { ReplicaStatus } from "@repo/library-replica/library-replica";
import { describe, expect, it } from "vitest";

import { createLeaveGuard, replicaHolds } from "./leave-guard";

// a leave as the browser makes it: the page asks first when the event comes back prevented
const leaving = (target: EventTarget): "asks" | "goes" =>
  target.dispatchEvent(new Event("beforeunload", { cancelable: true })) ? "goes" : "asks";

// a holder whose state the test sets, telling the guard each time it moves
const holder = (initial: boolean) => {
  let holds = initial;
  let moved: (() => void) | null = null;
  return {
    holding: () => holds,
    onMove: (listener: () => void) => {
      moved = listener;
      return () => {
        moved = null;
      };
    },
    set: (next: boolean) => {
      holds = next;
      moved?.();
    },
  };
};

const status = (over: Partial<ReplicaStatus>): ReplicaStatus => ({
  bodies: { fetched: 0, total: 0 },
  cursor: 0,
  failure: null,
  head: 0,
  parked: [],
  syncing: false,
  unsent: 0,
  ...over,
});

describe("asking before the tab leaves", () => {
  it("asks only while a holder holds something, and lets the page go once it is sent", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const replica = holder(false);
    guard.hold(replica.holding, replica.onMove);
    expect(leaving(target)).toBe("goes");
    replica.set(true);
    expect(leaving(target)).toBe("asks");
    replica.set(false);
    expect(leaving(target)).toBe("goes");
  });

  it("asks while any of its holders holds, and forgets a holder released", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const replica = holder(false);
    const editor = holder(true);
    guard.hold(replica.holding, replica.onMove);
    const release = guard.hold(editor.holding, editor.onMove);
    expect(leaving(target)).toBe("asks");
    release();
    expect(leaving(target)).toBe("goes");
    // a released holder's moves no longer reach the guard
    editor.set(true);
    expect(leaving(target)).toBe("goes");
  });

  it("lets the page go for good once it leaves on purpose", () => {
    const target = new EventTarget();
    const guard = createLeaveGuard(target);
    const replica = holder(true);
    guard.hold(replica.holding, replica.onMove);
    guard.drop();
    expect(leaving(target)).toBe("goes");
    replica.set(true);
    expect(leaving(target)).toBe("goes");
  });
});

describe("what the replica holds", () => {
  it("holds writes not yet sent, unless its session ended and they can no longer go", () => {
    expect(replicaHolds(status({ unsent: 0 }))).toBe(false);
    expect(replicaHolds(status({ unsent: 2 }))).toBe(true);
    expect(
      replicaHolds(status({ failure: { kind: "unreachable", message: "offline" }, unsent: 2 })),
    ).toBe(true);
    expect(
      replicaHolds(status({ failure: { end: "signed-out", kind: "session" }, unsent: 2 })),
    ).toBe(false);
  });
});
