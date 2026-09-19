// every provider event triggers a timeline re-ask, so per-call work over the
// whole log is quadratic in the turn's own event count.

import path from "node:path";
import { createConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { noopNotifier } from "@repo/domain/notifier";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { turnScope } from "@repo/domain/thread-event-scope";
import type * as BuildThreadTimeline from "@repo/api/local/build-thread-timeline";
import type * as DbEvents from "@repo/db/events";
import { applyTimelineDelta } from "@repo/api/local/thread-timeline";
import type { ThreadTimeline } from "@repo/api/local/thread-timeline";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ThreadService } from "../service";
import { unavailableTurnDriver } from "../turn-driver";
import { makeTempDir } from "../../__tests__/temp-dir";

const { reads, projections } = vi.hoisted(() => ({
  projections: { calls: 0 },
  reads: { calls: 0, rows: 0 },
}));

// counted at the module every reader goes through: a counting reader handed to
// ThreadService would bound only the reads the test wired.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock("@repo/db/events", async (importOriginal) => {
  const actual = await importOriginal<typeof DbEvents>();
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

// reached through an import, so the module is the only vantage that sees a rebuild down the call path.
// oxlint-disable-next-line anti-slop/no-module-mocking
vi.mock("@repo/api/local/build-thread-timeline", async (importOriginal) => {
  const actual = await importOriginal<typeof BuildThreadTimeline>();
  return {
    ...actual,
    buildThreadTimeline: (...args: Parameters<typeof actual.buildThreadTimeline>) => {
      projections.calls += 1;
      return actual.buildThreadTimeline(...args);
    },
  };
});

const openService = () => {
  const db = createConnection(path.join(makeTempDir("inteligir-timeline-cost-"), "test.db"));
  runMigrations(db);
  return {
    db,
    service: new ThreadService({
      createTurnDriver: () => unavailableTurnDriver,
      db,
      notifier: noopNotifier,
    }),
  };
};

const streamingThread = (service: ThreadService) => {
  const thread = service.create({});
  const scope = turnScope("turn_1");
  const base = { scope, threadId: thread.id };
  const started: ThreadEvent = { type: "turn/started", ...base };
  const opened: ThreadEvent = {
    type: "item/started",
    ...base,
    item: { id: "item_a", text: "", type: "agentMessage" },
  };
  service.ingestProviderEvents(thread.id, [started, opened]);
  return {
    delta: (n: number) => {
      service.ingestProviderEvents(thread.id, [
        { ...base, delta: `t${n} `, itemId: "item_a", type: "item/agentMessage/delta" },
      ]);
    },
    threadId: thread.id,
  };
};

beforeEach(() => {
  reads.rows = 0;
  reads.calls = 0;
  projections.calls = 0;
});

describe("a frame during a streaming turn", () => {
  it("reads only the events that landed since the last one", () => {
    const { service } = openService();
    const { threadId, delta } = streamingThread(service);

    const held = service.timeline({ threadId });
    if (held?.kind !== "full") {
      throw new Error("expected a full timeline");
    }
    // the first ask reads the whole log: turn/started + item/started.
    expect(reads.rows).toBe(2);
    let sequence = held.timeline.maxSequence;

    reads.rows = 0;
    for (let index = 0; index < 30; index += 1) {
      delta(index);
      const next = service.timeline({ afterSequence: sequence, threadId });
      if (next?.kind !== "delta") {
        throw new Error("expected a delta");
      }
      sequence = next.delta.maxSequence;
    }
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
      const next = service.timeline({ afterSequence: sequence, threadId });
      if (next?.kind !== "delta") {
        throw new Error("expected a delta");
      }
      sequence = next.delta.maxSequence;
    }
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
      service.timeline({ afterSequence: stale.maxSequence + index, threadId });
    }

    const caught = service.timeline({ afterSequence: stale.maxSequence, threadId });
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
