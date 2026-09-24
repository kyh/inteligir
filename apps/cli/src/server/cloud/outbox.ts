// serialize once, at enqueue, and push the stored bytes: the log calls a stored
// position replayed with a different body sync-conflict, so re-serializing at
// push time turns every retry after a grammar change into one.

import { clipThreadEventForSync } from "@repo/api/cloud/sync/fit-sync-event";
import {
  EVENT_MAX_BYTES,
  PUSH_MAX_EVENTS,
  PUSH_MAX_THREADS,
  syncEventInputSchema,
  threadMetaInputSchema,
} from "@repo/api/cloud/sync/sync-schema";
import type {
  PushRequest,
  SyncEventInput,
  ThreadMetaInput,
} from "@repo/api/cloud/sync/sync-schema";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  deleteSyncOutboxThrough,
  enqueueSyncOutboxInTransaction,
  listSyncOutbox,
} from "@repo/db/sync-outbox";
import { threadEventSchema } from "@repo/domain/provider-event";
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

// the cloud's row for a thread whose frozen body names it: read from the same bytes, so the two
// halves of a push cannot disagree. a thread a desktop runs is no dispatch, so its lane is "any".
const threadMetaOf = (event: ThreadEvent, createdAt: number): ThreadMetaInput | null => {
  if (event.type !== "thread/meta" || event.title === undefined) {
    return null;
  }
  const meta = threadMetaInputSchema.safeParse({
    lane: "any",
    threadId: event.threadId,
    title: event.title,
    updatedAt: createdAt,
  });
  return meta.success ? meta.data : null;
};

// a row the contract refuses is left out but stays inside the high-water so the
// ack drops it: the log refuses a whole batch for one bad event. the `threads` half
// carries each named thread's latest title, and a batch ends before the row that
// would take it past the contract's cap.
export const takePushBatch = (db: DbConnection): PushBatch | null => {
  const rows = listSyncOutbox(db, PUSH_BATCH_SIZE);
  const events: SyncEventInput[] = [];
  const threads = new Map<string, ThreadMetaInput>();
  const rejected: RejectedOutboxRow[] = [];
  let throughDeviceSeq: number | null = null;
  for (const row of rows) {
    let body: unknown;
    try {
      body = JSON.parse(row.body);
    } catch {
      rejected.push({ deviceSeq: row.deviceSeq, reason: "the stored body is not JSON" });
      throughDeviceSeq = row.deviceSeq;
      continue;
    }
    const event = threadEventSchema.safeParse(body);
    const meta = event.success ? threadMetaOf(event.data, row.createdAt) : null;
    if (meta !== null && !threads.has(meta.threadId) && threads.size >= PUSH_MAX_THREADS) {
      break;
    }
    throughDeviceSeq = row.deviceSeq;
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
    if (meta !== null) {
      threads.set(meta.threadId, meta);
    }
  }
  if (throughDeviceSeq === null) {
    return null;
  }
  const request: PushRequest =
    threads.size === 0 ? { events } : { events, threads: [...threads.values()] };
  return { rejected, request, throughDeviceSeq };
};

// accepted and duplicates alike: both mean the position is in the log with these bytes. the
// rejected rows go with them, and are counted as never reaching it.
export const ackPushBatch = (db: DbConnection, batch: PushBatch): void => {
  deleteSyncOutboxThrough(db, batch.throughDeviceSeq, batch.rejected.length);
};
