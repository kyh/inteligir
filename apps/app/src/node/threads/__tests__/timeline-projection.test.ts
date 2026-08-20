// What a ws frame may cost the timeline. Every provider event notifies the
// thread and every subscriber answers by asking for the timeline again, so a
// turn asks n times while its own log grows to n: anything this path does over
// the WHOLE log per call is quadratic in the turn's own event count.

import { join } from "node:path";
import { createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import { applyTimelineDelta, type ThreadTimeline } from "@repo/server-contract/thread-timeline";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadService } from "../service";
import { unavailableTurnDriver } from "../turn-driver";
import { makeTempDir } from "../../__tests__/temp-dir";

const { reads, projections } = vi.hoisted(() => ({
  reads: { rows: 0, calls: 0 },
  projections: { calls: 0 },
}));

// A COST bound, not a behaviour: one row read per frame, never the log so far.
// It has to hold for every path the service reaches, so the count is taken at
// the module every reader goes through. Handing ThreadService a counting
// reader instead would bound only the reads the test itself wired up, and a
// quadratic re-read is exactly the kind nobody wires on purpose.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock("@repo/db/events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/db/events")>();
  return {
    ...actual,
    listStoredThreadEvents: (...args: Parameters<typeof actual.listStoredThreadEvents>) => {
      const rows = actual.listStoredThreadEvents(...args);
      reads.calls += 1;
      reads.rows += rows.length;
      return rows;
    },
  };
});

// `buildThreadTimeline` is a pure function reached through an import, so there
// is no boundary a fake could sit at: the claim is that a frame projects once,
// from the projection served last, rather than rebuilding the turn from its
// whole log. Counting at the module is the only vantage that sees a rebuild
// made somewhere down the call path.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock("@repo/thread-view/build-thread-timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@repo/thread-view/build-thread-timeline")>();
  return {
    ...actual,
    buildThreadTimeline: (...args: Parameters<typeof actual.buildThreadTimeline>) => {
      projections.calls += 1;
      return actual.buildThreadTimeline(...args);
    },
  };
});

function openService() {
  const db = createConnection(join(makeTempDir("inteligir-timeline-cost-"), "test.db"));
  runMigrations(db);
  return {
    db,
    service: new ThreadService({
      db,
      notifier: noopNotifier,
      createTurnDriver: () => unavailableTurnDriver,
    }),
  };
}

/** A thread mid-turn, with a streaming assistant message open. */
function streamingThread(service: ThreadService) {
  const thread = service.create({});
  const scope = turnScope("turn_1");
  const base = { threadId: thread.id, scope };
  const started: ThreadEvent = { type: "turn/started", ...base };
  const opened: ThreadEvent = {
    type: "item/started",
    ...base,
    item: { type: "agentMessage", id: "item_a", text: "" },
  };
  service.ingestProviderEvents(thread.id, [started, opened]);
  return {
    threadId: thread.id,
    delta: (n: number) => {
      service.ingestProviderEvents(thread.id, [
        { type: "item/agentMessage/delta", ...base, itemId: "item_a", delta: `t${n} ` },
      ]);
    },
  };
}

beforeEach(() => {
  reads.rows = 0;
  reads.calls = 0;
  projections.calls = 0;
});

describe("a frame during a streaming turn", () => {
  it("reads only the events that landed since the last one", () => {
    const { service } = openService();
    const { threadId, delta } = streamingThread(service);

    let held = service.timeline({ threadId });
    if (held?.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    // The first ask reads the whole log: turn/started + item/started.
    expect(reads.rows).toBe(2);
    let sequence = held.timeline.maxSequence;

    reads.rows = 0;
    for (let index = 0; index < 30; index += 1) {
      delta(index);
      const next = service.timeline({ threadId, afterSequence: sequence });
      if (next?.kind !== "delta") {
        throw new Error("expected a delta");
      }
      sequence = next.delta.maxSequence;
    }
    // One row per frame — never the log so far.
    expect(reads.rows).toBe(30);
  });

  it("projects once per frame: the base is the projection it served last", () => {
    const { service } = openService();
    const { threadId, delta } = streamingThread(service);

    let sequence = 0;
    const first = service.timeline({ threadId });
    if (first?.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    sequence = first.timeline.maxSequence;

    projections.calls = 0;
    for (let index = 0; index < 30; index += 1) {
      delta(index);
      const next = service.timeline({ threadId, afterSequence: sequence });
      if (next?.kind !== "delta") {
        throw new Error("expected a delta");
      }
      sequence = next.delta.maxSequence;
    }
    // The delta branch used to build the timeline TWICE per frame: once for
    // the log and once for the base prefix it diffs against.
    expect(projections.calls).toBe(30);
  });

  it("still answers a client several frames behind, and the delta still applies", () => {
    const { service } = openService();
    const { threadId, delta } = streamingThread(service);

    const first = service.timeline({ threadId });
    if (first?.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    const stale: ThreadTimeline = first.timeline;
    for (let index = 0; index < 12; index += 1) {
      delta(index);
      service.timeline({ threadId, afterSequence: stale.maxSequence + index });
    }

    const caught = service.timeline({ threadId, afterSequence: stale.maxSequence });
    if (caught?.kind !== "delta") {
      throw new Error("expected a delta");
    }
    const applied = applyTimelineDelta(stale, caught.delta);
    const rebuilt = service.timeline({ threadId });
    if (rebuilt?.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    expect(applied).toEqual(rebuilt.timeline);
  });
});
