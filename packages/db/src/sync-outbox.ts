import { asc, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createSyncOutboxId } from "./ids";
import { syncAppliedCaptures, syncOutbox, syncState } from "./schema";

export type SyncOutboxRow = typeof syncOutbox.$inferSelect;

const SYNC_STATE_ID = 1;

export interface SyncState {
  lastDeviceSeq: number;
  cursor: number;
  lastSyncedAt: number | null;
}

const EMPTY_SYNC_STATE: SyncState = { cursor: 0, lastDeviceSeq: 0, lastSyncedAt: null };

type SyncWriteConnection = DbConnection | DbTransaction;

// lazy rather than seeded by a migration, so a database restored from a file predating the seed
// still works.
const ensureSyncStateRow = (db: SyncWriteConnection): void => {
  db.insert(syncState).values({ id: SYNC_STATE_ID }).onConflictDoNothing().run();
};

export const readSyncState = (db: DbConnection): SyncState => {
  const row = db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).get();
  if (row === undefined) {
    return EMPTY_SYNC_STATE;
  }
  return { cursor: row.cursor, lastDeviceSeq: row.lastDeviceSeq, lastSyncedAt: row.lastSyncedAt };
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

// bounded by the pushed batch's own high-water, so an enqueue that landed mid-push survives the
// ack.
export const deleteSyncOutboxThrough = (db: DbConnection, throughDeviceSeq: number): number =>
  db.delete(syncOutbox).where(lte(syncOutbox.deviceSeq, throughDeviceSeq)).run().changes;

// takes a transaction so a pulled event is appended and marked applied in one write; a crash
// between the two replays the page into duplicates.
export const writeSyncCursor = (db: SyncWriteConnection, cursor: number): void => {
  ensureSyncStateRow(db);
  db.update(syncState).set({ cursor }).where(eq(syncState.id, SYNC_STATE_ID)).run();
};

// separate from the cursor: a device with nothing to pull is up to date, not stale.
export const touchSyncedAt = (db: DbConnection, at: number): void => {
  ensureSyncStateRow(db);
  db.update(syncState).set({ lastSyncedAt: at }).where(eq(syncState.id, SYNC_STATE_ID)).run();
};

// on logout: a cursor carried into a second account would skip that account's log from its
// first row.
export const resetSyncState = (db: DbConnection): void => {
  db.delete(syncOutbox).run();
  db.delete(syncAppliedCaptures).run();
  db.delete(syncState).run();
};

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
