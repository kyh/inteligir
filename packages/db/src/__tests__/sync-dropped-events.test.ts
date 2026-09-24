import { describe, expect, it } from "vitest";
import { closeConnection, createConnection, writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import { runMigrations } from "../migrate";
import {
  countSyncOutbox,
  deleteSyncOutboxThrough,
  dropSyncOutboxThrough,
  enqueueSyncOutboxInTransaction,
  readSyncState,
  resetSyncState,
} from "../sync-outbox";
import { openTempDb, openTempDbWithPath } from "./open-temp-db";

const enqueue = (db: DbConnection, count: number): void => {
  writeTransaction(db, (tx) => {
    enqueueSyncOutboxInTransaction(
      tx,
      Array.from({ length: count }, (_, index) => ({ body: `{"n":${index}}`, threadId: "thr_1" })),
    );
  });
};

describe("the dropped-events count", () => {
  it("counts an ack's refused rows and every row a refusal deletes, and outlives a restart", () => {
    const { databasePath, db } = openTempDbWithPath();
    enqueue(db, 5);

    deleteSyncOutboxThrough(db, 2, 1);
    expect(readSyncState(db).droppedEvents).toBe(1);

    expect(dropSyncOutboxThrough(db, 4)).toBe(2);
    expect(readSyncState(db).droppedEvents).toBe(3);
    expect(countSyncOutbox(db)).toBe(1);
    closeConnection(db);

    const reopened = createConnection(databasePath);
    runMigrations(reopened);
    expect(readSyncState(reopened).droppedEvents).toBe(3);
    closeConnection(reopened);
  });

  it("counts nothing for an ack whose rows all reached the log", () => {
    const db = openTempDb();
    enqueue(db, 2);
    deleteSyncOutboxThrough(db, 2, 0);
    expect(readSyncState(db).droppedEvents).toBe(0);
  });

  it("is forgotten with the positions a sign-out clears", () => {
    const db = openTempDb();
    enqueue(db, 2);
    dropSyncOutboxThrough(db, 2);
    resetSyncState(db);
    expect(readSyncState(db).droppedEvents).toBe(0);
  });
});
