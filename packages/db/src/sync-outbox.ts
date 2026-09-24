import { asc, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import { writeTransaction } from "./connection";
import type { DbConnection, DbExecutor, DbTransaction } from "./connection";
import { createSyncOutboxId } from "./ids";
import { syncAppliedCaptures, syncOutbox, syncOwnDevices, syncState } from "./schema";

export type SyncOutboxRow = typeof syncOutbox.$inferSelect;

const SYNC_STATE_ID = 1;

export interface SyncState {
  lastDeviceSeq: number;
  cursor: number;
  lastSyncedAt: number | null;
  droppedEvents: number;
}

const EMPTY_SYNC_STATE: SyncState = {
  cursor: 0,
  droppedEvents: 0,
  lastDeviceSeq: 0,
  lastSyncedAt: null,
};

// lazy rather than seeded by a migration, so a database restored from a file predating the seed
// still works.
const ensureSyncStateRow = (db: DbExecutor): void => {
  db.insert(syncState).values({ id: SYNC_STATE_ID }).onConflictDoNothing().run();
};

export const readSyncState = (db: DbConnection): SyncState => {
  const row = db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).get();
  if (row === undefined) {
    return EMPTY_SYNC_STATE;
  }
  return {
    cursor: row.cursor,
    droppedEvents: row.droppedEvents,
    lastDeviceSeq: row.lastDeviceSeq,
    lastSyncedAt: row.lastSyncedAt,
  };
};

export interface SyncOutboxEntry {
  threadId: string;
  // already serialized by the caller: re-serializing here would be a different body at the same
  // position, which the log calls sync-conflict.
  body: string;
}

// takes a transaction so the enqueue commits with the append or not at all; a separate write
// could lose the row to a crash and leave an event no device hears about.
export const enqueueSyncOutboxInTransaction = (
  tx: DbTransaction,
  entries: readonly SyncOutboxEntry[],
): void => {
  if (entries.length === 0) {
    return;
  }
  ensureSyncStateRow(tx);
  // one range: the counter moves once, so a concurrent writer cannot interleave into this batch.
  const allocated = tx
    .update(syncState)
    .set({ lastDeviceSeq: sql`${syncState.lastDeviceSeq} + ${entries.length}` })
    .where(eq(syncState.id, SYNC_STATE_ID))
    .returning({ lastDeviceSeq: syncState.lastDeviceSeq })
    .get();
  if (allocated === undefined) {
    throw new Error("sync_state is missing: cannot allocate an outbox position");
  }
  const firstSeq = allocated.lastDeviceSeq - entries.length + 1;
  const now = Date.now();
  tx.insert(syncOutbox)
    .values(
      entries.map((entry, index) => ({
        body: entry.body,
        createdAt: now,
        deviceSeq: firstSeq + index,
        id: createSyncOutboxId(),
        threadId: entry.threadId,
      })),
    )
    .run();
};

export const listSyncOutbox = (db: DbConnection, limit: number): SyncOutboxRow[] =>
  db.select().from(syncOutbox).orderBy(asc(syncOutbox.deviceSeq)).limit(limit).all();

export const countSyncOutbox = (db: DbConnection): number =>
  db.select({ value: count() }).from(syncOutbox).get()?.value ?? 0;

const deleteThrough = (tx: DbTransaction, throughDeviceSeq: number): number =>
  tx.delete(syncOutbox).where(lte(syncOutbox.deviceSeq, throughDeviceSeq)).run().changes;

const countDropped = (tx: DbTransaction, dropped: number): void => {
  if (dropped === 0) {
    return;
  }
  ensureSyncStateRow(tx);
  tx.update(syncState)
    .set({ droppedEvents: sql`${syncState.droppedEvents} + ${dropped}` })
    .where(eq(syncState.id, SYNC_STATE_ID))
    .run();
};

// bounded by the pushed batch's own high-water, so an enqueue that landed mid-push survives the
// ack. `dropped` is how many of those rows never left, refused before the push: counted in the
// delete's transaction, so a crash cannot delete a row it never counted.
export const deleteSyncOutboxThrough = (
  db: DbConnection,
  throughDeviceSeq: number,
  dropped: number,
): void => {
  writeTransaction(db, (tx) => {
    deleteThrough(tx, throughDeviceSeq);
    countDropped(tx, dropped);
  });
};

// the log refused the queue at this position, so every row deleted is one it will never hold.
export const dropSyncOutboxThrough = (db: DbConnection, throughDeviceSeq: number): number =>
  writeTransaction(db, (tx) => {
    const dropped = deleteThrough(tx, throughDeviceSeq);
    countDropped(tx, dropped);
    return dropped;
  });

// takes a transaction so a pulled event is appended and marked applied in one write; a crash
// between the two replays the page into duplicates.
export const writeSyncCursor = (db: DbExecutor, cursor: number): void => {
  ensureSyncStateRow(db);
  db.update(syncState).set({ cursor }).where(eq(syncState.id, SYNC_STATE_ID)).run();
};

export interface SkippedLogRow {
  seq: number;
  build: string;
}

// in the transaction that moves the cursor past the row: apart, a crash between the two loses the
// row for good. the lowest is kept, because a rewind replays from it.
export const recordSkippedRow = (tx: DbTransaction, row: SkippedLogRow): void => {
  ensureSyncStateRow(tx);
  tx.update(syncState)
    .set({
      skippedByBuild: row.build,
      skippedFromSeq: sql`min(coalesce(${syncState.skippedFromSeq}, ${row.seq}), ${row.seq})`,
    })
    .where(eq(syncState.id, SYNC_STATE_ID))
    .run();
};

// a build other than the one that skipped may read the row now, so the cursor goes back to just
// before it and the marker clears; a build that still cannot read it records it again. the replay
// lands nothing twice: a foreign row dedupes on its origin, and the planner skips this install's
// own. answers the row the pull restarts from, or null when nothing moved.
export const takeRewindIfBuildChanged = (db: DbConnection, build: string): number | null =>
  writeTransaction(db, (tx) => {
    const row = tx
      .select({
        cursor: syncState.cursor,
        skippedByBuild: syncState.skippedByBuild,
        skippedFromSeq: syncState.skippedFromSeq,
      })
      .from(syncState)
      .where(eq(syncState.id, SYNC_STATE_ID))
      .get();
    if (row === undefined || row.skippedFromSeq === null || row.skippedByBuild === build) {
      return null;
    }
    tx.update(syncState)
      .set({
        cursor: Math.min(row.cursor, row.skippedFromSeq - 1),
        skippedByBuild: null,
        skippedFromSeq: null,
      })
      .where(eq(syncState.id, SYNC_STATE_ID))
      .run();
    return row.skippedFromSeq;
  });

// separate from the cursor: a device with nothing to pull is up to date, not stale.
export const touchSyncedAt = (db: DbConnection, at: number): void => {
  ensureSyncStateRow(db);
  db.update(syncState).set({ lastSyncedAt: at }).where(eq(syncState.id, SYNC_STATE_ID)).run();
};

// on logout: a cursor carried into a second account would skip that account's log from its
// first row. one transaction, so a crash cannot keep one account's queue beside the next one's
// positions. sync_own_devices is kept: the log still holds rows under those ids.
export const resetSyncState = (db: DbConnection): void => {
  writeTransaction(db, (tx) => {
    tx.delete(syncOutbox).run();
    tx.delete(syncAppliedCaptures).run();
    tx.delete(syncState).run();
  });
};

export const recordOwnDevice = (db: DbExecutor, deviceId: string): void => {
  db.insert(syncOwnDevices).values({ deviceId }).onConflictDoNothing().run();
};

export const ownDeviceIds = (db: DbExecutor): ReadonlySet<string> =>
  new Set(
    db
      .select({ deviceId: syncOwnDevices.deviceId })
      .from(syncOwnDevices)
      .all()
      .map((row) => row.deviceId),
  );

export const unappliedCaptureIds = (db: DbConnection, ids: readonly string[]): Set<string> => {
  if (ids.length === 0) {
    return new Set();
  }
  const applied = new Set(
    db
      .select({ id: syncAppliedCaptures.id })
      .from(syncAppliedCaptures)
      .where(inArray(syncAppliedCaptures.id, [...ids]))
      .all()
      .map((row) => row.id),
  );
  return new Set(ids.filter((id) => !applied.has(id)));
};

// runs after the vault write commits: the reverse order loses a capture to a crash, this order
// at worst repeats one.
export const recordAppliedCaptures = (
  db: DbConnection,
  ids: readonly string[],
  now: number,
): void => {
  if (ids.length === 0) {
    return;
  }
  db.insert(syncAppliedCaptures)
    .values(ids.map((id) => ({ appliedAt: now, id })))
    .onConflictDoNothing()
    .run();
};

export const pruneAppliedCaptures = (db: DbConnection, before: number): void => {
  db.delete(syncAppliedCaptures).where(lt(syncAppliedCaptures.appliedAt, before)).run();
};
