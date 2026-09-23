import { closeConnection, createConnection, writeTransaction } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { runMigrations } from "@repo/db/migrate";
import { readSyncState } from "@repo/db/sync-outbox";
import { threadEventSchema } from "@repo/domain/provider-event";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope, turnScope } from "@repo/domain/thread-event-scope";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ackPushBatch, enqueueThreadEvents, takePushBatch } from "../outbox";
import { makeTempDir } from "../../__tests__/temp-dir";

const openStore = (dataDir: string): DbConnection => {
  const db = createConnection(path.join(dataDir, "inteligir.db"));
  runMigrations(db);
  return db;
};

const enqueue = (db: DbConnection, events: readonly ThreadEvent[]): void => {
  writeTransaction(db, (tx) => {
    enqueueThreadEvents(tx, events);
  });
};

const message = (threadId: string, text: string): ThreadEvent => ({
  scope: threadScope(),
  text,
  threadId,
  type: "client/turn/requested",
});

describe("the outbox", () => {
  it("numbers positions strictly increasing across batches, and across a restart", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    let db = openStore(dataDir);
    enqueue(db, [message("thr_1", "one"), message("thr_1", "two")]);
    enqueue(db, [message("thr_1", "three")]);
    expect(takePushBatch(db)?.request.events.map((event) => event.deviceSeq)).toEqual([1, 2, 3]);

    const drained = takePushBatch(db);
    if (drained === null) {
      throw new Error("expected a batch");
    }
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
      { scope: turnScope("turn_1"), threadId: "thr_1", type: "turn/started" },
      message("thr_1", "hello"),
    ]);
    const before = takePushBatch(db);
    closeConnection(db);

    db = openStore(dataDir);
    const after = takePushBatch(db);
    closeConnection(db);

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
    if (batch === null) {
      throw new Error("expected a batch");
    }
    enqueue(db, [message("thr_1", "two")]);
    ackPushBatch(db, batch);

    expect(takePushBatch(db)?.request.events.map((event) => event.deviceSeq)).toEqual([2]);
    closeConnection(db);
  });

  it("freezes an over-cap event clipped, so a large command output still syncs, settled", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    const db = openStore(dataDir);
    const output = "compiling…\n".repeat(20_000);
    enqueue(db, [
      {
        item: {
          aggregatedOutput: output,
          approvalStatus: null,
          command: "make",
          cwd: "/vault",
          exitCode: 0,
          id: "item_c",
          status: "completed",
          type: "commandExecution",
        },
        scope: turnScope("turn_1"),
        threadId: "thr_1",
        type: "item/completed",
      },
      message("thr_1", "x".repeat(70_000)),
    ]);
    const batch = takePushBatch(db);
    expect(batch?.rejected).toEqual([]);
    const [command, said] = (batch?.request.events ?? []).map((row) =>
      threadEventSchema.parse(row.event),
    );
    if (command?.type !== "item/completed" || command.item.type !== "commandExecution") {
      throw new Error("expected the command's completion");
    }
    expect(command.item.status).toBe("completed");
    expect(command.item.aggregatedOutput?.length).toBeLessThan(output.length);
    expect(command.item.aggregatedOutput).toContain("bytes elided");
    expect(said?.type).toBe("client/turn/requested");
    closeConnection(db);
  });

  it("leaves an event the log would refuse out of the batch rather than wedging", () => {
    const dataDir = makeTempDir("inteligir-outbox-");
    const db = openStore(dataDir);
    // no payload text to clip: the envelope alone is past the contract's per-event byte ceiling.
    enqueue(db, [
      {
        item: {
          approvalStatus: null,
          changes: Array.from({ length: 3000 }, (_, index) => ({
            kind: "add",
            path: `notes/renamed-in-bulk-${index}.md`,
          })),
          id: "item_f",
          status: "completed",
          type: "fileChange",
        },
        scope: turnScope("turn_1"),
        threadId: "thr_1",
        type: "item/completed",
      },
      message("thr_1", "the one that must still get through"),
    ]);
    const batch = takePushBatch(db);
    expect(batch?.rejected.map((row) => row.deviceSeq)).toEqual([1]);
    expect(batch?.request.events.map((event) => event.deviceSeq)).toEqual([2]);
    if (batch === null) {
      throw new Error("expected a batch");
    }
    ackPushBatch(db, batch);
    expect(takePushBatch(db)).toBeNull();
    closeConnection(db);
  });
});
