// serialize once, at enqueue, and push the stored bytes: the log calls a stored
// position replayed with a different body sync-conflict, so re-serializing at
// push time turns every retry after a grammar change into one.

import {
  PUSH_MAX_EVENTS,
  syncEventInputSchema,
  type PushRequest,
  type SyncEventInput,
} from "@repo/api/cloud/sync/sync-schema";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  deleteSyncOutboxThrough,
  enqueueSyncOutboxInTransaction,
  listSyncOutbox,
} from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";

// the contract's ceiling — a batch over it is refused whole.
const PUSH_BATCH_SIZE = PUSH_MAX_EVENTS;

// same transaction as the append: a separate write can lose the queue row to a crash.
export function enqueueThreadEvents(tx: DbTransaction, events: readonly ThreadEvent[]): void {
  enqueueSyncOutboxInTransaction(
    tx,
    events.map((event) => ({ threadId: event.threadId, body: JSON.stringify(event) })),
  );
}

interface RejectedOutboxRow {
  deviceSeq: number;
  reason: string;
}

export interface PushBatch {
  request: PushRequest;
  /** what the ack deletes through, so an enqueue that landed mid-push survives. */
  throughDeviceSeq: number;
  rejected: readonly RejectedOutboxRow[];
}

// a row the contract refuses is left out but stays inside the high-water so the
// ack drops it: the log refuses a whole batch for one bad event. the push's
// `threads` half is not sent — the pull answers events alone, so nothing reads it back.
export function takePushBatch(db: DbConnection): PushBatch | null {
  const rows = listSyncOutbox(db, PUSH_BATCH_SIZE);
  const last = rows.at(-1);
  if (last === undefined) {
    return null;
  }
  const events: SyncEventInput[] = [];
  const rejected: RejectedOutboxRow[] = [];
  for (const row of rows) {
    let body: unknown;
    try {
      body = JSON.parse(row.body);
    } catch {
      rejected.push({ deviceSeq: row.deviceSeq, reason: "the stored body is not JSON" });
      continue;
    }
    const parsed = syncEventInputSchema.safeParse({
      threadId: row.threadId,
      deviceSeq: row.deviceSeq,
      event: body,
      createdAt: row.createdAt,
    });
    if (!parsed.success) {
      rejected.push({ deviceSeq: row.deviceSeq, reason: parsed.error.issues[0]?.message ?? "" });
      continue;
    }
    events.push(parsed.data);
  }
  return { request: { events }, throughDeviceSeq: last.deviceSeq, rejected };
}

// accepted and duplicates alike: both mean the position is in the log with these bytes.
export function ackPushBatch(db: DbConnection, batch: PushBatch): void {
  deleteSyncOutboxThrough(db, batch.throughDeviceSeq);
}
