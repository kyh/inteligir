import { describe, expect, it } from "vitest";
import { writeTransaction } from "../connection";
import type { DbConnection } from "../connection";
import {
  readSyncState,
  recordSkippedRow,
  resetSyncState,
  takeRewindIfBuildChanged,
  writeSyncCursor,
} from "../sync-outbox";
import { openTempDb } from "./open-temp-db";

// the write a pull makes when it moves past a row it cannot read.
const skipPast = (db: DbConnection, seq: number, build: string): void => {
  writeTransaction(db, (tx) => {
    writeSyncCursor(tx, seq);
    recordSkippedRow(tx, { build, seq });
  });
};

describe("the skipped-row marker", () => {
  it("rewinds to just before the lowest skipped row once the build changes, and only once", () => {
    const db = openTempDb();
    skipPast(db, 4, "1.0.0");
    writeSyncCursor(db, 6);
    skipPast(db, 9, "1.0.0");
    writeSyncCursor(db, 12);

    expect(takeRewindIfBuildChanged(db, "1.0.0")).toBeNull();
    expect(readSyncState(db).cursor).toBe(12);

    expect(takeRewindIfBuildChanged(db, "1.1.0")).toBe(4);
    expect(readSyncState(db).cursor).toBe(3);
    expect(takeRewindIfBuildChanged(db, "1.2.0")).toBeNull();
    expect(readSyncState(db).cursor).toBe(3);
  });

  it("is forgotten with the positions a sign-out clears", () => {
    const db = openTempDb();
    skipPast(db, 4, "1.0.0");
    resetSyncState(db);
    expect(takeRewindIfBuildChanged(db, "1.1.0")).toBeNull();
    expect(readSyncState(db).cursor).toBe(0);
  });
});
