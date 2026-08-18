// The cloud sync bookkeeping: the outbox queue, this device's two positions,
// and the applied-capture ledger. The tables' own reasons are in `schema.ts`;
// what lives here is the rule that only SQL can hold — a wire position is
// allocated from a counter, never from the queue that drains.

import { asc, count, eq, inArray, lt, lte, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createSyncOutboxId } from "./ids";
import { syncAppliedCaptures, syncOutbox, syncState } from "./schema";

export type SyncOutboxRow = typeof syncOutbox.$inferSelect;

/** The one row `sync_state` may hold; the CHECK makes a second unrepresentable. */
const SYNC_STATE_ID = 1;

export interface SyncState {
  /** Highest wire position this device has ever allocated. */
  lastDeviceSeq: number;
  /** The account log's global `seq` this device has applied through. */
  cursor: number;
  lastSyncedAt: number | null;
}

const EMPTY_SYNC_STATE: SyncState = { lastDeviceSeq: 0, cursor: 0, lastSyncedAt: null };

type SyncWriteConnection = DbConnection | DbTransaction;

/** Materialize the singleton before a write touches it. Lazy rather than
 *  seeded by the migration, so a database restored from a file that predates
 *  the seed still works. */
function ensureSyncStateRow(db: SyncWriteConnection): void {
  db.insert(syncState).values({ id: SYNC_STATE_ID }).onConflictDoNothing().run();
}

export function readSyncState(db: DbConnection): SyncState {
  const row = db.select().from(syncState).where(eq(syncState.id, SYNC_STATE_ID)).get();
  if (row === undefined) {
    return EMPTY_SYNC_STATE;
  }
  return { lastDeviceSeq: row.lastDeviceSeq, cursor: row.cursor, lastSyncedAt: row.lastSyncedAt };
}

export interface SyncOutboxEntry {
  threadId: string;
  /** The event's serialized bytes. Taken as a string on purpose: the caller
   *  froze them, and a value re-serialized here would be a different body at
   *  the same position — which the log calls `sync-conflict`. */
  body: string;
}

/**
 * Queue events for the log, allocating each a wire position from the counter.
 *
 * Takes a transaction rather than a connection: an event is owed to the cloud
 * exactly when it is owed to the local log, so the enqueue commits with the
 * append or not at all. A separate write could lose the queue row to a crash
 * and leave an event no device ever hears about.
 */
export function enqueueSyncOutboxInTransaction(
  tx: DbTransaction,
  entries: readonly SyncOutboxEntry[],
): void {
  if (entries.length === 0) {
    return;
  }
  ensureSyncStateRow(tx);
  // Allocated as one range: the counter moves once, so a concurrent writer
  // cannot interleave into the middle of this batch's positions.
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
        id: createSyncOutboxId(),
        deviceSeq: firstSeq + index,
        threadId: entry.threadId,
        body: entry.body,
        createdAt: now,
      })),
    )
    .run();
}

/** The next rows to push, oldest position first — the order the log requires
 *  within a batch. */
export function listSyncOutbox(db: DbConnection, limit: number): SyncOutboxRow[] {
  return db.select().from(syncOutbox).orderBy(asc(syncOutbox.deviceSeq)).limit(limit).all();
}

export function countSyncOutbox(db: DbConnection): number {
  return db.select({ value: count() }).from(syncOutbox).get()?.value ?? 0;
}

/** Drop the positions the log has now stored. Bounded by the pushed batch's
 *  own high-water, so an enqueue that landed while the push was in flight
 *  survives the ack. */
export function deleteSyncOutboxThrough(db: DbConnection, throughDeviceSeq: number): number {
  return db
    .delete(syncOutbox)
    .where(lte(syncOutbox.deviceSeq, throughDeviceSeq))
    .returning({ id: syncOutbox.id })
    .all().length;
}

/**
 * Move the applied-through position. Takes a transaction as well as a
 * connection because the caller that matters passes one: a pulled event is
 * appended and marked applied in ONE write, so a crash cannot land between
 * them and replay the page into duplicate rows.
 */
export function writeSyncCursor(db: SyncWriteConnection, cursor: number): void {
  ensureSyncStateRow(db);
  db.update(syncState).set({ cursor }).where(eq(syncState.id, SYNC_STATE_ID)).run();
}

/** When a pass last completed, whatever it found. Separate from the cursor
 *  because "caught up" and "checked" are different facts — a device with
 *  nothing to pull is up to date, not stale. */
export function touchSyncedAt(db: DbConnection, at: number): void {
  ensureSyncStateRow(db);
  db.update(syncState).set({ lastSyncedAt: at }).where(eq(syncState.id, SYNC_STATE_ID)).run();
}

/**
 * Forget everything this device knows about the account it was paired with:
 * the unpushed queue, both positions, and the applied-capture ledger. Called
 * on unpair, because every one of those values is meaningful only against the
 * credential that is going away — a cursor carried into a second account would
 * skip that account's log from its own first row.
 */
export function resetSyncState(db: DbConnection): void {
  db.delete(syncOutbox).run();
  db.delete(syncAppliedCaptures).run();
  db.delete(syncState).run();
}

/** Which of `ids` this device has NOT yet written into the vault. */
export function unappliedCaptureIds(db: DbConnection, ids: readonly string[]): Set<string> {
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
}

/** Record ids as applied. Runs AFTER the vault write commits: the reverse
 *  order loses a capture to a crash, and this order at worst repeats one. */
export function recordAppliedCaptures(db: DbConnection, ids: readonly string[], now: number): void {
  if (ids.length === 0) {
    return;
  }
  db.insert(syncAppliedCaptures)
    .values(ids.map((id) => ({ id, appliedAt: now })))
    .onConflictDoNothing()
    .run();
}

export function pruneAppliedCaptures(db: DbConnection, before: number): number {
  return db
    .delete(syncAppliedCaptures)
    .where(lt(syncAppliedCaptures.appliedAt, before))
    .returning({ id: syncAppliedCaptures.id })
    .all().length;
}
