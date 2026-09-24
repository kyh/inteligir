import { createConnection, writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { describe, expect, it, vi } from "vitest";
import {
  appendEventsInTransaction,
  listStoredThreadEvents,
  listThreadMetaEvents,
  MissingTurnStartedError,
} from "../events";
import type { AppendEventsResult } from "../events";
import { noopNotifier } from "@repo/domain/notifier";
import { createThread } from "../threads";
import { openTempDbWithPath } from "./open-temp-db";

// the transaction the server composes every append in.
const append = (db: DbConnection, events: readonly ThreadEvent[]): AppendEventsResult =>
  writeTransaction(db, (tx) => appendEventsInTransaction(tx, events));

const lastSequence = (db: DbConnection, threadId: string): number =>
  listStoredThreadEvents(db, { threadId }).at(-1)?.sequence ?? 0;

const turnStarted = (threadId: string, turnId: string): ThreadEvent => ({
  scope: turnScope(turnId),
  threadId,
  type: "turn/started",
});

const agentDelta = (threadId: string, turnId: string, delta: string): ThreadEvent => ({
  delta,
  itemId: "item_1",
  scope: turnScope(turnId),
  threadId,
  type: "item/agentMessage/delta",
});

describe("appendEventsInTransaction", () => {
  it("assigns contiguous per-thread sequences across batches", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const other = createThread(db, noopNotifier, {});

    const first = append(db, [
      turnStarted(thread.id, "turn_1"),
      agentDelta(thread.id, "turn_1", "a"),
      turnStarted(other.id, "turn_9"),
    ]);
    expect(first.sequences).toEqual([1, 2, 1]);

    const second = append(db, [agentDelta(thread.id, "turn_1", "b")]);
    expect(second.sequences).toEqual([3]);
    expect(lastSequence(db, thread.id)).toBe(3);
    expect(lastSequence(db, other.id)).toBe(1);
  });

  it("never duplicates (threadId, sequence) under interleaved writers", () => {
    const { db, databasePath } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    append(db, [turnStarted(thread.id, "turn_1")]);

    // a second connection is an independent writer whose high-water read races the first's
    // inserts.
    const rival = createConnection(databasePath);
    for (let round = 0; round < 25; round += 1) {
      append(db, [agentDelta(thread.id, "turn_1", `db-${round}`)]);
      append(rival, [agentDelta(thread.id, "turn_1", `rival-${round}`)]);
    }

    const stored = listStoredThreadEvents(db, { threadId: thread.id });
    const sequences = stored.map((entry) => entry.sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    expect(sequences).toEqual(Array.from({ length: stored.length }, (_, index) => index + 1));
  });

  it("refuses turn content before its turn/started is stored", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    expect(() => append(db, [agentDelta(thread.id, "turn_ghost", "x")])).toThrow(
      MissingTurnStartedError,
    );
    expect(lastSequence(db, thread.id)).toBe(0);
  });

  it("round-trips events through the stored JSON", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const request: ThreadEvent = {
      scope: threadScope(),
      text: "hello",
      threadId: thread.id,
      type: "client/turn/requested",
    };
    append(db, [request, turnStarted(thread.id, "turn_1")]);
    const stored = listStoredThreadEvents(db, { threadId: thread.id });
    expect(stored.map((entry) => entry.event)).toEqual([request, turnStarted(thread.id, "turn_1")]);
    expect(listStoredThreadEvents(db, { afterSequence: 1, threadId: thread.id })).toHaveLength(1);
  });

  it("leaves out and reports a stored row this build's grammar refuses, keeping the rest", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    append(db, [turnStarted(thread.id, "turn_1")]);
    // what a newer build sharing the data dir writes: a type this grammar has never seen.
    db.$client
      .prepare(
        `INSERT INTO events (id, thread_id, scope_kind, turn_id, sequence, type, data, created_at)
         VALUES ('evt_newer', ?, 'thread', NULL, 2, 'item/fromANewerBuild', ?, 0)`,
      )
      .run(
        thread.id,
        JSON.stringify({ scope: threadScope(), threadId: thread.id, type: "item/fromANewerBuild" }),
      );
    append(db, [agentDelta(thread.id, "turn_1", "after")]);

    const skipped: { sequence: number; type: string }[] = [];
    const stored = listStoredThreadEvents(db, {
      onSkipped: (row) => {
        skipped.push(row);
      },
      threadId: thread.id,
    });
    expect(stored.map((entry) => entry.sequence)).toEqual([1, 3]);
    expect(skipped).toEqual([{ sequence: 2, type: "item/fromANewerBuild" }]);
    expect(listStoredThreadEvents(db, { afterSequence: 1, threadId: thread.id })).toHaveLength(1);
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

// the type admits an empty turn id; only the write's parse refuses one.
describe("the event grammar at the write", () => {
  it("refuses a turn scope with no turn id at the write, persisting nothing", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    expect(() => append(db, [turnStarted(thread.id, "")])).toThrow(/turnId/u);
    expect(lastSequence(db, thread.id)).toBe(0);
  });

  it("refuses a batch atomically: a bad tail rolls back the good head", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    expect(() =>
      append(db, [turnStarted(thread.id, "turn_1"), turnStarted(thread.id, "")]),
    ).toThrow(/turnId/u);
    expect(lastSequence(db, thread.id)).toBe(0);
  });
});

describe("reading a thread's own facts", () => {
  it("seeks the (thread, turn, type, item) index rather than walking the thread", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    const meta: ThreadEvent = {
      scope: threadScope(),
      threadId: thread.id,
      title: "Plans",
      type: "thread/meta",
    };
    append(db, [turnStarted(thread.id, "turn_1"), meta, agentDelta(thread.id, "turn_1", "a")]);

    const prepared: string[] = [];
    const client = db.$client;
    const original = client.prepare.bind(client);
    const spy = vi.spyOn(client, "prepare").mockImplementation((source: string) => {
      prepared.push(source);
      return original(source);
    });
    expect(listThreadMetaEvents(db, thread.id)).toEqual([meta]);
    spy.mockRestore();

    const [source] = prepared;
    expect(source).toBeDefined();
    const plan = client
      .prepare(`EXPLAIN QUERY PLAN ${source ?? ""}`)
      .all(thread.id, "thread/meta")
      .map((row) => JSON.stringify(row))
      .join("\n");
    expect(plan).toMatch(
      /events_thread_turn_type_item_sequence_idx \(thread_id=\? AND turn_id=\? AND type=\? AND item_id=\?\)/u,
    );
  });
});

describe("the cost of a burst", () => {
  it("prepares two SELECTs and one INSERT, whatever the burst carries", () => {
    const { db } = openTempDbWithPath();
    const thread = createThread(db, noopNotifier, {});
    append(db, [turnStarted(thread.id, "turn_1")]);

    const prepared: string[] = [];
    const client = db.$client;
    const original = client.prepare.bind(client);
    const spy = vi.spyOn(client, "prepare").mockImplementation((source: string) => {
      prepared.push(source.trim().toLowerCase());
      return original(source);
    });

    append(
      db,
      Array.from({ length: 20 }, (_, index) => agentDelta(thread.id, "turn_1", `d${index}`)),
    );
    spy.mockRestore();

    expect(prepared.filter((source) => source.startsWith("select"))).toHaveLength(2);
    expect(prepared.filter((source) => source.startsWith("insert"))).toHaveLength(1);
  });
});
