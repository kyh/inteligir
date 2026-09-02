import { createConnection } from "../connection";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, vi } from "vitest";
import {
  appendEvents,
  getMaxSequence,
  listStoredThreadEvents,
  MissingTurnStartedError,
} from "../events";
import { noopNotifier } from "@repo/domain/notifier";
import { createThread } from "../threads";
import { openTempDbWithPath } from "./open-temp-db";

function turnStarted(threadId: string, turnId: string): ThreadEvent {
  return { type: "turn/started", threadId, scope: turnScope(turnId) };
}

function agentDelta(threadId: string, turnId: string, delta: string): ThreadEvent {
  return {
    type: "item/agentMessage/delta",
    threadId,
    itemId: "item_1",
    delta,
    scope: turnScope(turnId),
  };
}

describe("appendEvents", () => {
  it("assigns contiguous per-thread sequences across batches", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const other = createThread(db, noopNotifier, {});

    const first = appendEvents(db, noopNotifier, [
      turnStarted(thread.id, "turn_1"),
      agentDelta(thread.id, "turn_1", "a"),
      turnStarted(other.id, "turn_9"),
    ]);
    expect(first.sequences).toEqual([1, 2, 1]);

    const second = appendEvents(db, noopNotifier, [agentDelta(thread.id, "turn_1", "b")]);
    expect(second.sequences).toEqual([3]);
    expect(getMaxSequence(db, thread.id)).toBe(3);
    expect(getMaxSequence(db, other.id)).toBe(1);
  });

  it("never duplicates (threadId, sequence) under interleaved writers", () => {
    const { db, databasePath } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    appendEvents(db, noopNotifier, [turnStarted(thread.id, "turn_1")]);

    // a second connection is an independent writer whose high-water read races the first's
    // inserts.
    const rival = createConnection(databasePath);
    for (let round = 0; round < 25; round += 1) {
      appendEvents(db, noopNotifier, [agentDelta(thread.id, "turn_1", `db-${round}`)]);
      appendEvents(rival, noopNotifier, [agentDelta(thread.id, "turn_1", `rival-${round}`)]);
    }

    const stored = listStoredThreadEvents(db, { threadId: thread.id });
    const sequences = stored.map((entry) => entry.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual(Array.from({ length: stored.length }, (_, index) => index + 1));
  });

  it("refuses turn content before its turn/started is stored", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    expect(() =>
      appendEvents(db, noopNotifier, [agentDelta(thread.id, "turn_ghost", "x")]),
    ).toThrow(MissingTurnStartedError);
    expect(getMaxSequence(db, thread.id)).toBe(0);
  });

  it("round-trips events through the stored JSON", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const request: ThreadEvent = {
      type: "client/turn/requested",
      threadId: thread.id,
      text: "hello",
      scope: threadScope(),
    };
    appendEvents(db, noopNotifier, [request, turnStarted(thread.id, "turn_1")]);
    const stored = listStoredThreadEvents(db, { threadId: thread.id });
    expect(stored.map((entry) => entry.event)).toEqual([request, turnStarted(thread.id, "turn_1")]);
    expect(listStoredThreadEvents(db, { threadId: thread.id, afterSequence: 1 })).toHaveLength(1);
  });

  it("enforces the scope CHECK at the database, not only at parse", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    expect(() =>
      db.$client
        .prepare(
          `INSERT INTO events (id, thread_id, scope_kind, turn_id, sequence, type, item_id, item_kind, data, created_at)
           VALUES ('evt_bad', ?, 'turn', NULL, 1, 'turn/started', NULL, NULL, '{}', 0)`,
        )
        .run(thread.id),
    ).toThrow(/CHECK/u);
  });
});

describe("scope policy at the write", () => {
  it("refuses a thread-scoped turn/started at the write, persisting nothing", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const invalid: ThreadEvent = {
      type: "turn/started",
      threadId: thread.id,
      scope: threadScope(),
    };
    expect(() => appendEvents(db, noopNotifier, [invalid])).toThrow(/requires turn scope/u);
    expect(getMaxSequence(db, thread.id)).toBe(0);
  });

  it("refuses a batch atomically: a bad tail rolls back the good head", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const invalid: ThreadEvent = {
      type: "turn/started",
      threadId: thread.id,
      scope: threadScope(),
    };
    expect(() =>
      appendEvents(db, noopNotifier, [turnStarted(thread.id, "turn_1"), invalid]),
    ).toThrow(/requires turn scope/u);
    expect(getMaxSequence(db, thread.id)).toBe(0);
  });
});

describe("the cost of a burst", () => {
  it("prepares two SELECTs and one INSERT, whatever the burst carries", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    appendEvents(db, noopNotifier, [turnStarted(thread.id, "turn_1")]);

    const prepared: string[] = [];
    const client = db.$client;
    const original = client.prepare.bind(client);
    const spy = vi.spyOn(client, "prepare").mockImplementation((source: string) => {
      prepared.push(source.trim().toLowerCase());
      return original(source);
    });

    appendEvents(
      db,
      noopNotifier,
      Array.from({ length: 20 }, (_, index) => agentDelta(thread.id, "turn_1", `d${index}`)),
    );
    spy.mockRestore();

    expect(prepared.filter((source) => source.startsWith("select"))).toHaveLength(2);
    expect(prepared.filter((source) => source.startsWith("insert"))).toHaveLength(1);
  });
});
