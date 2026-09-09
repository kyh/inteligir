import { describe, expect, it } from "vitest";
import {
  evaluateThreadLifecycleEvent,
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
} from "../thread-lifecycle";
import type {
  ThreadLifecycleEvent,
  ThreadLifecycleEventType,
  ThreadLifecycleRowState,
} from "../thread-lifecycle";
import { threadStatusValues } from "../thread-status";
import type { ThreadStatus } from "../thread-status";

const eventTypes: readonly ThreadLifecycleEventType[] = [
  "run.preparing",
  "run.started",
  "run.succeeded",
  "run.failed",
  "stop.requested",
  "stop.settled",
];

// mulberry32, seeded so a failing sequence reproduces.
const makeRandom = (seed: number): (() => number) => {
  let state = seed;
  return () => {
    /* oxlint-disable no-bitwise, unicorn/prefer-math-trunc -- mulberry32 is int32 bit math; Math.trunc drops the wrap */
    state = (state + 0x6d_2b_79_f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    /* oxlint-enable no-bitwise, unicorn/prefer-math-trunc */
  };
};

const pick = <T>(random: () => number, values: readonly T[]): T => {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error("pick from empty array");
  }
  return value;
};

const TURN_ID_POOL = ["turn_a", "turn_b", "turn_c"] as const;

const eventFor = (
  type: ThreadLifecycleEvent["type"],
  activeTurnId: string | null,
): ThreadLifecycleEvent => {
  if (type === "run.started") {
    return { turnId: "turn_y", type };
  }
  if (type === "run.succeeded" || type === "run.failed" || type === "stop.settled") {
    return { turnId: activeTurnId, type };
  }
  return { type };
};

const randomEvent = (random: () => number): ThreadLifecycleEvent => {
  const type = pick(random, eventTypes);
  switch (type) {
    case "run.preparing":
    case "stop.requested": {
      return { type };
    }
    case "run.started": {
      return { turnId: pick(random, TURN_ID_POOL), type };
    }
    case "run.succeeded":
    case "run.failed":
    case "stop.settled": {
      return { turnId: random() < 0.3 ? null : pick(random, TURN_ID_POOL), type };
    }
    // no default
  }
};

const applyEvent = (
  thread: ThreadLifecycleRowState,
  event: ThreadLifecycleEvent,
): ThreadLifecycleRowState => {
  const evaluation = evaluateThreadLifecycleEvent({ event, thread });
  if ("noop" in evaluation) {
    return thread;
  }
  return { ...thread, activeTurnId: evaluation.activeTurnId, status: evaluation.to };
};

describe("evaluateThreadLifecycleEvent", () => {
  it("keeps every random event sequence inside the declared statuses and turn-binding invariants", () => {
    const statuses: ReadonlySet<string> = new Set(threadStatusValues);
    for (let run = 0; run < 500; run += 1) {
      const random = makeRandom(run + 1);
      const startStatus = pick(random, threadStatusValues);
      // seed only states the machine can produce: a turn is bound only while a run is in progress.
      const startTurnId =
        startStatus === "active" || (startStatus === "stopping" && random() < 0.5)
          ? pick(random, TURN_ID_POOL)
          : null;
      let thread: ThreadLifecycleRowState = {
        activeTurnId: startTurnId,
        archivedAt: random() < 0.2 ? 1 : null,
        status: startStatus,
      };
      for (let step = 0; step < 40; step += 1) {
        const event = randomEvent(random);
        const before = thread;
        const evaluation = evaluateThreadLifecycleEvent({ event, thread });
        thread = applyEvent(thread, event);
        expect(statuses.has(thread.status)).toBe(true);
        if ("noop" in evaluation) {
          expect(thread).toEqual(before);
        } else {
          expect(evaluation.to).toBe(THREAD_LIFECYCLE[before.status][event.type]);
        }
        if (thread.status === "idle" || thread.status === "error" || thread.status === "starting") {
          expect(thread.activeTurnId).toBeNull();
        }
        if (thread.status === "active") {
          expect(thread.activeTurnId).not.toBeNull();
        }
      }
    }
  });

  it("reports every absent table cell as an illegal-transition no-op", () => {
    for (const status of threadStatusValues) {
      for (const type of eventTypes) {
        const expected = THREAD_LIFECYCLE[status][type];
        // bound to the row's own turn so only the table decides.
        const activeTurnId = status === "active" || status === "stopping" ? "turn_x" : null;
        const event = eventFor(type, activeTurnId);
        const evaluation = evaluateThreadLifecycleEvent({
          event,
          thread: { activeTurnId, archivedAt: null, status },
        });
        if (expected === undefined) {
          expect(evaluation).toEqual({
            detail: `no transition for ${type} from status ${status}`,
            noop: "illegal-transition",
          });
        } else {
          expect(evaluation).toMatchObject({ to: expected });
        }
      }
    }
  });

  it("refuses a settle that names a turn other than the active one", () => {
    const active: ThreadLifecycleRowState = {
      activeTurnId: "turn_b",
      archivedAt: null,
      status: "active",
    };
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: "turn_a", type: "run.succeeded" },
        thread: active,
      }),
    ).toEqual({
      detail: "run.succeeded names turn turn_a but the active turn is turn_b",
      noop: "stale-turn",
    });
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: "turn_b", type: "run.succeeded" },
        thread: active,
      }),
    ).toEqual({ activeTurnId: null, to: "idle" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: null, type: "run.failed" },
        thread: { activeTurnId: null, archivedAt: null, status: "starting" },
      }),
    ).toEqual({ activeTurnId: null, to: "error" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: null, type: "run.failed" },
        thread: active,
      }),
    ).toMatchObject({ noop: "stale-turn" });
  });

  it("supersedes new work on archived threads before table lookup", () => {
    const archived: ThreadLifecycleRowState = {
      activeTurnId: null,
      archivedAt: 5,
      status: "idle",
    };
    expect(
      evaluateThreadLifecycleEvent({ event: { type: "run.preparing" }, thread: archived }),
    ).toEqual({ detail: "archivedAt set", noop: "superseded" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: "turn_a", type: "run.started" },
        thread: archived,
      }),
    ).toEqual({ detail: "archivedAt set", noop: "superseded" });

    const archivedActive: ThreadLifecycleRowState = {
      activeTurnId: "turn_a",
      archivedAt: 5,
      status: "active",
    };
    expect(
      evaluateThreadLifecycleEvent({
        event: { turnId: "turn_a", type: "run.succeeded" },
        thread: archivedActive,
      }),
    ).toEqual({ activeTurnId: null, to: "idle" });
  });

  it("cannot dispatch new work out of stopping, structurally", () => {
    expect(THREAD_LIFECYCLE.stopping["run.started"]).toBeUndefined();
    expect(THREAD_LIFECYCLE.stopping["run.preparing"]).toBeUndefined();
  });

  it("fuzzes every event type the predicate table declares", () => {
    expect([...eventTypes].toSorted()).toEqual(
      Object.keys(THREAD_LIFECYCLE_EVENT_PREDICATES).toSorted(),
    );
  });

  it("every reachable status can reach idle again", () => {
    const reachesIdle = new Set<ThreadStatus>(["idle"]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const status of threadStatusValues) {
        if (reachesIdle.has(status)) {
          continue;
        }
        const targets = Object.values(THREAD_LIFECYCLE[status]);
        if (targets.some((target) => reachesIdle.has(target))) {
          reachesIdle.add(status);
          grew = true;
        }
      }
    }
    expect([...reachesIdle].toSorted()).toEqual([...threadStatusValues].toSorted());
  });
});
