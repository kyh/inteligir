import { describe, expect, it } from "vitest";
import {
  evaluateThreadLifecycleEvent,
  THREAD_LIFECYCLE,
  THREAD_LIFECYCLE_EVENT_PREDICATES,
  type ThreadLifecycleEvent,
  type ThreadLifecycleEventType,
  type ThreadLifecycleRowState,
} from "../thread-lifecycle";
import { threadStatusValues, type ThreadStatus } from "../thread-status";

const eventTypes: readonly ThreadLifecycleEventType[] = [
  "run.preparing",
  "run.started",
  "run.succeeded",
  "run.failed",
  "stop.requested",
  "stop.settled",
];

/** Deterministic PRNG (mulberry32) so a failing sequence reproduces. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(random: () => number, values: readonly T[]): T {
  const value = values[Math.floor(random() * values.length)];
  if (value === undefined) {
    throw new Error("pick from empty array");
  }
  return value;
}

const TURN_ID_POOL = ["turn_a", "turn_b", "turn_c"] as const;

function randomEvent(random: () => number): ThreadLifecycleEvent {
  const type = pick(random, eventTypes);
  switch (type) {
    case "run.preparing":
    case "stop.requested":
      return { type };
    case "run.started":
      return { type, turnId: pick(random, TURN_ID_POOL) };
    case "run.succeeded":
    case "run.failed":
    case "stop.settled":
      return { type, turnId: random() < 0.3 ? null : pick(random, TURN_ID_POOL) };
  }
}

function applyEvent(
  thread: ThreadLifecycleRowState,
  event: ThreadLifecycleEvent,
): ThreadLifecycleRowState {
  const evaluation = evaluateThreadLifecycleEvent({ event, thread });
  if ("noop" in evaluation) {
    return thread;
  }
  return { ...thread, status: evaluation.to, activeTurnId: evaluation.activeTurnId };
}

describe("evaluateThreadLifecycleEvent", () => {
  it("keeps every random event sequence inside the declared statuses and turn-binding invariants", () => {
    const statuses: ReadonlySet<string> = new Set(threadStatusValues);
    for (let run = 0; run < 500; run += 1) {
      const random = makeRandom(run + 1);
      const startStatus = pick(random, threadStatusValues);
      // Seed only states the machine can produce: a bound turn exists exactly
      // while a run is in progress (stopping may carry one or none).
      const startTurnId =
        startStatus === "active" || (startStatus === "stopping" && random() < 0.5)
          ? pick(random, TURN_ID_POOL)
          : null;
      let thread: ThreadLifecycleRowState = {
        status: startStatus,
        activeTurnId: startTurnId,
        archivedAt: random() < 0.2 ? 1 : null,
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
        // A quiescent or not-yet-started thread is bound to no turn; an
        // active thread is always bound to exactly the turn that started.
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
        // Bind the event to the row's own turn so only the table decides.
        const activeTurnId = status === "active" || status === "stopping" ? "turn_x" : null;
        const event: ThreadLifecycleEvent =
          type === "run.started"
            ? { type, turnId: "turn_y" }
            : type === "run.succeeded" || type === "run.failed" || type === "stop.settled"
              ? { type, turnId: activeTurnId }
              : { type };
        const evaluation = evaluateThreadLifecycleEvent({
          event,
          thread: { status, activeTurnId, archivedAt: null },
        });
        if (expected === undefined) {
          expect(evaluation).toEqual({
            noop: "illegal-transition",
            detail: `no transition for ${type} from status ${status}`,
          });
        } else {
          expect(evaluation).toMatchObject({ to: expected });
        }
      }
    }
  });

  it("refuses a settle that names a turn other than the active one", () => {
    const active: ThreadLifecycleRowState = {
      status: "active",
      activeTurnId: "turn_b",
      archivedAt: null,
    };
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.succeeded", turnId: "turn_a" },
        thread: active,
      }),
    ).toEqual({
      noop: "stale-turn",
      detail: "run.succeeded names turn turn_a but the active turn is turn_b",
    });
    // The matching settle lands and unbinds.
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.succeeded", turnId: "turn_b" },
        thread: active,
      }),
    ).toEqual({ to: "idle", activeTurnId: null });
    // A dispatch failure settles the run that never produced a turn — and
    // only when no turn is bound, so it cannot kill a started run.
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.failed", turnId: null },
        thread: { status: "starting", activeTurnId: null, archivedAt: null },
      }),
    ).toEqual({ to: "error", activeTurnId: null });
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.failed", turnId: null },
        thread: active,
      }),
    ).toMatchObject({ noop: "stale-turn" });
  });

  it("supersedes new work on archived threads before table lookup", () => {
    const archived: ThreadLifecycleRowState = {
      status: "idle",
      activeTurnId: null,
      archivedAt: 5,
    };
    expect(
      evaluateThreadLifecycleEvent({ event: { type: "run.preparing" }, thread: archived }),
    ).toEqual({ noop: "superseded", detail: "archivedAt set" });
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.started", turnId: "turn_a" },
        thread: archived,
      }),
    ).toEqual({ noop: "superseded", detail: "archivedAt set" });

    // stop/settle events carry no predicates: they must land even on an
    // archived thread, or an archive mid-run wedges the status forever.
    const archivedActive: ThreadLifecycleRowState = {
      status: "active",
      activeTurnId: "turn_a",
      archivedAt: 5,
    };
    expect(
      evaluateThreadLifecycleEvent({
        event: { type: "run.succeeded", turnId: "turn_a" },
        thread: archivedActive,
      }),
    ).toEqual({ to: "idle", activeTurnId: null });
  });

  it("cannot dispatch new work out of stopping, structurally", () => {
    expect(THREAD_LIFECYCLE.stopping["run.started"]).toBeUndefined();
    expect(THREAD_LIFECYCLE.stopping["run.preparing"]).toBeUndefined();
  });

  it("declares predicates for every event type", () => {
    for (const type of eventTypes) {
      expect(THREAD_LIFECYCLE_EVENT_PREDICATES[type]).toBeDefined();
    }
  });

  it("every reachable status can reach idle again", () => {
    // Liveness: no status is a trap. Walk the table as a graph.
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
