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

function applyEvent(
  thread: ThreadLifecycleRowState,
  event: ThreadLifecycleEvent,
): ThreadLifecycleRowState {
  const evaluation = evaluateThreadLifecycleEvent({ event, thread });
  if ("noop" in evaluation) {
    return thread;
  }
  return { ...thread, status: evaluation.to };
}

describe("evaluateThreadLifecycleEvent", () => {
  it("keeps every random event sequence inside the declared statuses", () => {
    const statuses: ReadonlySet<string> = new Set(threadStatusValues);
    for (let run = 0; run < 500; run += 1) {
      const random = makeRandom(run + 1);
      let thread: ThreadLifecycleRowState = {
        status: pick(random, threadStatusValues),
        archivedAt: random() < 0.2 ? 1 : null,
        deletedAt: random() < 0.2 ? 1 : null,
      };
      for (let step = 0; step < 30; step += 1) {
        const event: ThreadLifecycleEvent = { type: pick(random, eventTypes) };
        const before = thread.status;
        const evaluation = evaluateThreadLifecycleEvent({ event, thread });
        thread = applyEvent(thread, event);
        expect(statuses.has(thread.status)).toBe(true);
        if ("noop" in evaluation) {
          expect(thread.status).toBe(before);
        } else {
          expect(evaluation.to).toBe(THREAD_LIFECYCLE[before][event.type]);
        }
      }
    }
  });

  it("reports every absent table cell as an illegal-transition no-op", () => {
    for (const status of threadStatusValues) {
      for (const type of eventTypes) {
        const expected = THREAD_LIFECYCLE[status][type];
        const evaluation = evaluateThreadLifecycleEvent({
          event: { type },
          thread: { status, archivedAt: null, deletedAt: null },
        });
        if (expected === undefined) {
          expect(evaluation).toEqual({
            noop: "illegal-transition",
            detail: `no transition for ${type} from status ${status}`,
          });
        } else {
          expect(evaluation).toEqual({ to: expected });
        }
      }
    }
  });

  it("supersedes new work on archived and deleted threads before table lookup", () => {
    const archived: ThreadLifecycleRowState = { status: "idle", archivedAt: 5, deletedAt: null };
    expect(
      evaluateThreadLifecycleEvent({ event: { type: "run.preparing" }, thread: archived }),
    ).toEqual({ noop: "superseded", detail: "archivedAt set" });

    const deleted: ThreadLifecycleRowState = { status: "idle", archivedAt: null, deletedAt: 5 };
    expect(
      evaluateThreadLifecycleEvent({ event: { type: "run.started" }, thread: deleted }),
    ).toEqual({ noop: "superseded", detail: "deletedAt set" });

    // stop/settle events carry no predicates: they must land even on an
    // archived thread, or an archive mid-run wedges the status forever.
    const archivedActive: ThreadLifecycleRowState = {
      status: "active",
      archivedAt: 5,
      deletedAt: null,
    };
    expect(
      evaluateThreadLifecycleEvent({ event: { type: "run.succeeded" }, thread: archivedActive }),
    ).toEqual({ to: "idle" });
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
