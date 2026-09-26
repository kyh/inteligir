// serialize once, at enqueue, and push the stored bytes: the log calls a stored
// position replayed with a different body sync-conflict, so re-serializing at
// push time turns every retry after a grammar change into one.

import { clipThreadEventForSync } from "@repo/api/cloud/sync/fit-sync-event";
import {
  EVENT_MAX_BYTES,
  PUSH_MAX_EVENTS,
  syncEventInputSchema,
} from "@repo/api/cloud/sync/sync-schema";
import type { PushRequest, SyncEventInput } from "@repo/api/cloud/sync/sync-schema";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  deleteSyncOutboxThrough,
  enqueueSyncOutboxInTransaction,
  listSyncOutbox,
} from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";

// the contract's ceiling — a batch over it is refused whole.
const PUSH_BATCH_SIZE = PUSH_MAX_EVENTS;

// same transaction as the append: a separate write can lose the queue row to a crash. the frozen
// body is the clipped one, so a large command output still reaches every device, cut in the middle.
export const enqueueThreadEvents = (tx: DbTransaction, events: readonly ThreadEvent[]): void => {
  enqueueSyncOutboxInTransaction(
    tx,
    events.map((event) => ({
      body: JSON.stringify(clipThreadEventForSync(event, EVENT_MAX_BYTES)),
      threadId: event.threadId,
    })),
  );
};

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
// ack drops it: the log refuses a whole batch for one bad event.
export const takePushBatch = (db: DbConnection): PushBatch | null => {
  const rows = listSyncOutbox(db, PUSH_BATCH_SIZE);
  const events: SyncEventInput[] = [];
  const rejected: RejectedOutboxRow[] = [];
  let throughDeviceSeq: number | null = null;
  for (const row of rows) {
    throughDeviceSeq = row.deviceSeq;
    let body: unknown;
    try {
      body = JSON.parse(row.body);
    } catch {
      rejected.push({ deviceSeq: row.deviceSeq, reason: "the stored body is not JSON" });
      continue;
    }
    const parsed = syncEventInputSchema.safeParse({
      createdAt: row.createdAt,
      deviceSeq: row.deviceSeq,
      event: body,
      threadId: row.threadId,
    });
    if (!parsed.success) {
      rejected.push({ deviceSeq: row.deviceSeq, reason: parsed.error.issues[0]?.message ?? "" });
      continue;
    }
    events.push(parsed.data);
  }
  if (throughDeviceSeq === null) {
    return null;
  }
  const request: PushRequest = { events };
  return { rejected, request, throughDeviceSeq };
};

// accepted and duplicates alike: both mean the position is in the log with these bytes. the
// rejected rows go with them, and are counted as never reaching it.
export const ackPushBatch = (db: DbConnection, batch: PushBatch): void => {
  deleteSyncOutboxThrough(db, batch.throughDeviceSeq, batch.rejected.length);
};
