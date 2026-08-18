// THE OUTBOX FREEZES BYTES, and that is the whole of this module. The queue
// itself is `@repo/db/sync-outbox`; what lives here is the serialization rule
// and the batch the wire takes.
//
// `@repo/cloud-contract/sync` states the rule: re-pushing a stored position is
// the RETRY path only while the body is byte-identical, and a different body
// at the same position is `sync-conflict` — data loss wearing idempotency's
// clothes, so the log refuses it rather than swallowing it.
//
// A client obeys that by serializing ONCE, at enqueue, and pushing what it
// stored. The bug the rule exists to catch is the tidy-looking alternative:
// keep the thread event, serialize it again at push time, and discover that a
// field a later build added — or a key order that moved — has turned every
// retry after an upgrade into a conflict.
//
// What "frozen" buys, precisely: the bytes the log stores are
// `JSON.stringify(JSON.parse(body))`, a pure function of the stored text. So
// two pushes of one row produce identical stored bytes, which is the property
// the retry path needs. It is NOT the claim that the stored text survives the
// round trip verbatim (whitespace and number spellings normalize); it is the
// claim that it always normalizes to the same thing.

import {
  PUSH_MAX_EVENTS,
  syncEventInputSchema,
  type PushRequest,
  type SyncEventInput,
} from "@repo/cloud-contract/sync";
import type { DbConnection, DbTransaction } from "@repo/db/connection";
import {
  deleteSyncOutboxThrough,
  enqueueSyncOutboxInTransaction,
  listSyncOutbox,
} from "@repo/db/sync-outbox";
import type { ThreadEvent } from "@repo/domain/provider-event";

/** A push carries at most this many rows — the contract's own ceiling, read
 *  rather than re-chosen, because a batch over it is refused whole. */
const PUSH_BATCH_SIZE = PUSH_MAX_EVENTS;

/**
 * Queue this device's own events for the log, inside the transaction that
 * appends them. Same transaction on purpose: an event is owed to the cloud
 * exactly when it is owed to the local log, and a second write could lose the
 * queue row to a crash and leave an event no other device ever hears about.
 */
export function enqueueThreadEvents(tx: DbTransaction, events: readonly ThreadEvent[]): void {
  enqueueSyncOutboxInTransaction(
    tx,
    events.map((event) => ({ threadId: event.threadId, body: JSON.stringify(event) })),
  );
}

/** A queued row the contract itself refuses — an event over the per-event byte
 *  ceiling, or bytes that no longer parse. */
interface RejectedOutboxRow {
  deviceSeq: number;
  reason: string;
}

export interface PushBatch {
  request: PushRequest;
  /** The batch's own high-water; what the ack deletes through, so an enqueue
   *  that landed while the push was in flight survives it. */
  throughDeviceSeq: number;
  rejected: readonly RejectedOutboxRow[];
}

/**
 * The next batch to push, or null when the queue is empty.
 *
 * Every row is validated against the contract HERE, and a row that fails is
 * left out of the request while staying inside the batch's high-water — so the
 * ack drops it. That is deliberate: an event the log will never accept (past
 * the 64 KiB per-event ceiling) would otherwise make the server refuse the
 * whole batch forever, and a wedged outbox loses every event behind the bad
 * one rather than just that one. Positions need only strictly increase, so the
 * gap a dropped row leaves is legal.
 *
 * The `threads` half of the contract's push is deliberately NOT sent. It
 * carries a thread's lane and title, and the pull answers events alone — so no
 * channel reads either value back, and a client writing a row it can never
 * read would be making a claim it cannot check. The lane's consumer is the
 * dispatch mailbox a mobile client would use; it belongs to whatever ships
 * that, together with the read side it needs.
 */
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
      // The frozen bytes, parsed straight back — never rebuilt from a domain
      // value. See the header.
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

/** Drop the rows the log has stored. Called for `accepted` AND `duplicates`
 *  alike: both mean the position is in the log with these bytes, which is the
 *  only fact the queue was holding them for. */
export function ackPushBatch(db: DbConnection, batch: PushBatch): void {
  deleteSyncOutboxThrough(db, batch.throughDeviceSeq);
}
