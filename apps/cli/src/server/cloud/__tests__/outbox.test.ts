// THE FROZEN-BODY RULE, which is the one property the log's retry path rests
// on: a position re-pushed with different bytes is `sync-conflict`, so what a
// device stores at enqueue is what it must send — after a restart, after an
// upgrade, forever.
//
// The restart is the part worth testing. Serializing at push time looks
// identical in one process and diverges the moment anything about the event's
// shape moves between the enqueue and the push, which is exactly what a
// restart spans.

import { closeConnection, createConnection, type DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { readSyncState } from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "../outbox";
import { makeTempDir } from "../../__tests__/temp-dir";

function openStore(dataDir: string): DbConnection {
  const db = createConnection(join(dataDir, "inteligir.db"));
  runMigrations(db);
  return db;
}

function enqueue(db: DbConnection, events: readonly ThreadEvent[]): void {
  db.transaction((tx) => enqueueThreadEvents(tx, events), { behavior: "immediate" });
}

function message(threadId: string, text: string): ThreadEvent {
  return { type: "client/turn/requested", threadId, text, kind: "message", scope: threadScope() };
}

describe("the outbox", () => {
  it("numbers positions strictly increasing across batches, and across a restart", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    let db = openStore(dataDir);
    enqueue(db, [message("thr_1", "one"), message("thr_1", "two")]);
    enqueue(db, [message("thr_1", "three")]);
    expect(takePushBatch(db)?.request.events.map((event) => event.deviceSeq)).toEqual([1, 2, 3]);

    // Drained: the queue is empty, so a counter read off the QUEUE would
    // restart at 1 and hand the log a position it already holds.
    const drained = takePushBatch(db);
    if (drained === null) throw new Error("expected a batch");
    ackPushBatch(db, drained);
    expect(takePushBatch(db)).toBeNull();

    closeConnection(db);
    db = openStore(dataDir);
    enqueue(db, [message("thr_1", "four")]);
    expect(takePushBatch(db)?.request.events.map((event) => event.deviceSeq)).toEqual([4]);
    expect(readSyncState(db).lastDeviceSeq).toBe(4);
    closeConnection(db);
  });

  it("pushes the bytes it stored, byte-identically, after a restart", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    let db = openStore(dataDir);
    enqueue(db, [
      { type: "turn/started", threadId: "thr_1", scope: turnScope("turn_1") },
      message("thr_1", "hello"),
    ]);
    const before = takePushBatch(db);
    closeConnection(db);

    db = openStore(dataDir);
    const after = takePushBatch(db);
    closeConnection(db);

    // What the log compares is `JSON.stringify(event.event)` on its own parse,
    // so identical serialized bodies is the exact condition for the retry path
    // rather than a conflict.
    expect(after?.request.events.map((event) => JSON.stringify(event.event))).toEqual(
      before?.request.events.map((event) => JSON.stringify(event.event)),
    );
    expect(after?.request.events).toEqual(before?.request.events);
  });

  it("acks only through the batch it pushed, so a concurrent enqueue survives", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    const db = openStore(dataDir);
    enqueue(db, [message("thr_1", "one")]);
    const batch = takePushBatch(db);
    if (batch === null) throw new Error("expected a batch");
    // The event a running turn appended while the push was in flight.
    enqueue(db, [message("thr_1", "two")]);
    ackPushBatch(db, batch);

    expect(takePushBatch(db)?.request.events.map((event) => event.deviceSeq)).toEqual([2]);
    closeConnection(db);
  });

  it("leaves an event the log would refuse out of the batch rather than wedging", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    const db = openStore(dataDir);
    // Past the contract's per-event byte ceiling: the log refuses the WHOLE
    // batch for it, so every event behind it would be stuck forever.
    enqueue(db, [
      message("thr_1", "x".repeat(70_000)),
      message("thr_1", "the one that must still get through"),
    ]);
    const batch = takePushBatch(db);
    expect(batch?.rejected.map((row) => row.deviceSeq)).toEqual([1]);
    expect(batch?.request.events.map((event) => event.deviceSeq)).toEqual([2]);
    // Both are inside the batch's high-water, so the ack clears the bad one too
    // and the queue moves on. Positions need only increase, not be contiguous.
    if (batch === null) throw new Error("expected a batch");
    ackPushBatch(db, batch);
    expect(takePushBatch(db)).toBeNull();
    closeConnection(db);
  });
});
