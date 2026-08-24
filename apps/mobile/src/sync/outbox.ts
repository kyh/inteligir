// THE OUTBOX FREEZES BYTES, and that is the whole of this module — the RN twin
// of apps/app/src/node/cloud/outbox.ts, over the injected `SyncStore` instead of
// better-sqlite3.
//
// `@repo/api/cloud/sync/sync-schema` states the rule the freezing obeys: re-pushing a
// stored position is the RETRY path only while the body is byte-identical, and a
// different body at the same position is `sync-conflict` — data loss wearing
// idempotency's clothes. A client honours it by serializing ONCE, at enqueue,
// and pushing what it stored. Serializing again at push time is the bug the rule
// exists to catch: a field a later build adds, or a key order that moves, turns
// every retry after an upgrade into a conflict.

import {
  PUSH_MAX_EVENTS,
  syncEventInputSchema,
  type PushRequest,
  type SyncEventInput,
} from "@repo/api/cloud/sync/sync-schema";
import type { ThreadEvent } from "@repo/domain/provider-event";
import type { SyncStore } from "./sync-store";

/** The contract's own batch ceiling, read rather than re-chosen — a batch over
 *  it is refused whole. */
const PUSH_BATCH_SIZE = PUSH_MAX_EVENTS;

/** A queued row the contract itself refuses: an event over the per-event byte
 *  ceiling, or bytes that no longer parse. */
interface RejectedOutboxRow {
  deviceSeq: number;
  reason: string;
}

export interface PushBatch {
  request: PushRequest;
  /** The batch's own high-water — what the ack deletes through, so an enqueue
   *  that landed mid-push survives it. */
  throughDeviceSeq: number;
  rejected: readonly RejectedOutboxRow[];
}

/** Queue this device's own events, frozen to bytes. `createdAt` is the client's
 *  own clock; the store assigns the device position. */
export function enqueueThreadEvents(
  store: SyncStore,
  events: readonly ThreadEvent[],
  now: number,
): void {
  if (events.length === 0) return;
  store.enqueueOutbox(
    events.map((event) => ({
      threadId: event.threadId,
      body: JSON.stringify(event),
      createdAt: now,
    })),
  );
}

/**
 * The next batch to push, or null when the queue is empty.
 *
 * Every row is validated against the contract HERE, and a row that fails is left
 * out of the request while staying inside the batch's high-water — so the ack
 * drops it. An event the log will never accept (past the 64 KiB per-event
 * ceiling) would otherwise make the server refuse the whole batch forever, and
 * a wedged outbox loses every event behind the bad one. Positions need only
 * strictly increase, so the gap a dropped row leaves is legal.
 *
 * The `threads` half of the contract's push (lane + title) is deliberately NOT
 * sent from the default runtime: the pull answers events alone, so no channel
 * reads either value back. Wiring a `desktop`-lane dispatch — a thread the phone
 * starts for a desktop agent to pick up — is where the lane rides this batch,
 * and it ships with its own read side.
 */
export function takePushBatch(store: SyncStore): PushBatch | null {
  const rows = store.listOutbox(PUSH_BATCH_SIZE);
  const last = rows.at(-1);
  if (last === undefined) return null;
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
export function ackPushBatch(store: SyncStore, batch: PushBatch): number {
  return store.deleteOutboxThrough(batch.throughDeviceSeq);
}
