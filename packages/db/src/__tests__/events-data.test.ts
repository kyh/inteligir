import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { afterEach, describe, expect, it } from "vitest";
import { createConnection, type DbConnection } from "../connection";
import {
  appendEvents,
  getMaxSequence,
  listStoredThreadEvents,
  MissingTurnStartedError,
} from "../events";
import { runMigrations } from "../migrate";
import { noopNotifier } from "../notifier";
import { createThread } from "../threads";

const tempDirs: string[] = [];

function openTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "inteligir-db-test-"));
  tempDirs.push(dir);
  return dir;
}

function openTempDb(): { db: DbConnection; databasePath: string } {
  const databasePath = join(openTempDir(), "test.db");
  const db = createConnection(databasePath);
  runMigrations(db);
  return { db, databasePath };
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

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
    const { db } = openTempDb();
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
    const { db, databasePath } = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    appendEvents(db, noopNotifier, [turnStarted(thread.id, "turn_1")]);

    // A second connection to the same file is a genuinely independent writer:
    // its high-water read races the first connection's inserts and only the
    // immediate transaction keeps the allocations disjoint.
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
    const { db } = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    expect(() =>
      appendEvents(db, noopNotifier, [agentDelta(thread.id, "turn_ghost", "x")]),
    ).toThrow(MissingTurnStartedError);
    // The refused batch left nothing behind.
    expect(getMaxSequence(db, thread.id)).toBe(0);
  });

  it("round-trips events through the stored JSON", () => {
    const { db } = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    const request: ThreadEvent = {
      type: "client/turn/requested",
      threadId: thread.id,
      text: "hello",
      kind: "message",
      scope: threadScope(),
    };
    appendEvents(db, noopNotifier, [request, turnStarted(thread.id, "turn_1")]);
    const stored = listStoredThreadEvents(db, { threadId: thread.id });
    expect(stored.map((entry) => entry.event)).toEqual([request, turnStarted(thread.id, "turn_1")]);
    expect(listStoredThreadEvents(db, { threadId: thread.id, afterSequence: 1 })).toHaveLength(1);
  });

  it("enforces the scope CHECK at the database, not only at parse", () => {
    const { db } = openTempDb();
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
    const { db } = openTempDb();
    const thread = createThread(db, noopNotifier, {});
    // The static type admits any (event, scope) pairing; the write-side parse
    // is what refuses it — before the SQL CHECK ever sees a row.
    const invalid: ThreadEvent = {
      type: "turn/started",
      threadId: thread.id,
      scope: threadScope(),
    };
    expect(() => appendEvents(db, noopNotifier, [invalid])).toThrow(/requires turn scope/u);
    expect(getMaxSequence(db, thread.id)).toBe(0);
  });

  it("refuses a batch atomically: a bad tail rolls back the good head", () => {
    const { db } = openTempDb();
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
