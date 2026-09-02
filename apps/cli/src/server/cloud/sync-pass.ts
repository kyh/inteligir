// One responsibility: ONE sync pass — drain the outbox, page the account's
// log forward and apply it, then take the capture inbox. Every step re-checks
// the session it started under (`fenced`) after EVERY await, immediately
// before any write; this module holds no session state of its own, so the
// runtime's fence is the only thing that can stop a step mid-pass.
//
// THE CURSOR MOVES INSIDE THE APPLY'S OWN TRANSACTION. That is what makes a
// pulled event land exactly once: appending it and recording that it was
// applied are one write, so a crash between them is impossible and a replay of
// the page cannot duplicate a row. Advancing afterwards would have been a
// second write, and the window between them is precisely where a duplicated
// conversation comes from.

import { CLAIM_DEFAULT_LIMIT } from "@repo/api/cloud/captures/captures-schema";
import { describeCloudFailure, type CloudClient, type CloudFailure } from "@repo/api/cloud/client";
import { SYNC_OUTBOX_CODES } from "@repo/api/cloud/errors";
import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import { pullPages } from "@repo/api/cloud/sync/sync-session";
import type { DbConnection } from "@repo/db/connection";
import type { SyncedEventInput } from "@repo/db/events";
import {
  deleteSyncOutboxThrough,
  pruneAppliedCaptures,
  readSyncState,
  recordAppliedCaptures,
  touchSyncedAt,
  unappliedCaptureIds,
  writeSyncCursor,
} from "@repo/db/sync-outbox";
import { messageOf } from "../error-message";
import { appendToInbox, APPLIED_CAPTURE_RETENTION_MS, type CaptureVault } from "./captures";
import { ackPushBatch, takePushBatch } from "./outbox";

/** Bound on one pass's drain, so a huge backlog cannot starve the pull half
 *  (or hold a shutdown open). What is left rides the next pass; the pull
 *  half's twin bound is the page loop's own. */
const MAX_PUSH_BATCHES_PER_PASS = 25;

/**
 * The one-transaction ingest, as the sync runtime needs it. Implemented by
 * `ThreadService`, which is the ONLY writer of thread events — a second append
 * path here would be a second answer to thread lifecycle.
 */
export interface SyncedEventSink {
  applySyncedEvents(args: {
    threadId: string;
    /** Each event WITH the log row's own identity, so the append can be
     *  idempotent on it — see `@repo/db/events`. */
    rows: readonly SyncedEventInput[];
    /** The log position these rows settle, written in the SAME transaction
     *  that appends them. */
    cursor: number;
  }): void;
}

/** What one pass runs under: the session it belongs to, and the credential's
 *  own identity. Captured once at the top so no step can read a newer one. */
export interface PassContext {
  sessionId: number;
  client: CloudClient;
  deviceId: string;
}

export interface SyncPassDeps {
  db: DbConnection;
  /** Where a claimed capture is written. */
  vault: CaptureVault;
  debug(message: string): void;
  /** Late-bound by the runtime — the thread service is built after it. */
  sink(): SyncedEventSink | null;
  /** True while `context`'s session is still the live one. Checked after
   *  EVERY await, immediately before any write. */
  fenced(context: PassContext): boolean;
  /** Records the failure; "ended" when it ended the session and the pass stops. */
  recordFailure(failure: CloudFailure): "continue" | "ended";
  setLastError(message: string | null): void;
}

/**
 * Drain the outbox. Returns false when the session ended.
 *
 * An outbox refusal is not retried: the log already holds a body at that
 * position (`sync-conflict`) or holds one past it (`sync-out-of-order`), so
 * the queued row can never land where it is numbered, and keeping it wedges
 * every event behind it forever. The rows through the named position are
 * dropped and the error is recorded loudly. What is lost is the CLOUD's copy
 * of those events — the local log still holds every one of them — and the
 * only way to reach this state is a database that lost its counter while the
 * account's log kept the positions it handed out.
 */
async function drain(deps: SyncPassDeps, context: PassContext): Promise<boolean> {
  for (let round = 0; round < MAX_PUSH_BATCHES_PER_PASS; round += 1) {
    if (!deps.fenced(context)) {
      return false;
    }
    const batch = takePushBatch(deps.db);
    if (batch === null) {
      return true;
    }
    for (const row of batch.rejected) {
      deps.debug(`dropping outbox position ${row.deviceSeq}: ${row.reason}`);
    }
    if (batch.request.events.length === 0) {
      ackPushBatch(deps.db, batch);
      continue;
    }
    const result = await context.client.push(batch.request);
    // The ack DELETES rows. A pair or unpair that landed while this request
    // was in flight has already emptied and re-numbered that queue, so an
    // ack from the old session would delete the new one's work.
    if (!deps.fenced(context)) {
      return false;
    }
    if (!result.ok) {
      if (result.failure.kind === "refused" && SYNC_OUTBOX_CODES.has(result.failure.code)) {
        const through = result.failure.deviceSeq ?? batch.throughDeviceSeq;
        const dropped = deleteSyncOutboxThrough(deps.db, through);
        deps.debug(
          `${result.failure.code} at position ${through}: dropped ${dropped} queued event(s) the log will not take`,
        );
        deps.setLastError(describeCloudFailure(result.failure));
        continue;
      }
      return deps.recordFailure(result.failure) === "continue";
    }
    ackPushBatch(deps.db, batch);
    deps.setLastError(null);
  }
  return true;
}

function applyStep(deps: SyncPassDeps, step: Extract<LogPlanStep, { kind: "apply" }>): void {
  const target = deps.sink();
  if (target === null) {
    throw new Error("cloud sync has no ingest sink attached");
  }
  const groupCursor = step.rows.at(-1)?.seq;
  if (groupCursor === undefined) {
    return;
  }
  try {
    target.applySyncedEvents({ threadId: step.threadId, rows: step.rows, cursor: groupCursor });
    return;
  } catch (error) {
    deps.debug(`applying ${step.rows.length} synced event(s) failed: ${messageOf(error)}`);
  }
  // One event the local log refuses — a turn-content event whose
  // `turn/started` this device never received, which is what pairing
  // mid-turn produces — must not take the rest of the group with it. Retried
  // one at a time so the group's good events still land.
  //
  // EACH RETRY COMMITS ITS OWN ROW'S POSITION, never the group's. The append
  // and the cursor share one transaction, so handing every retry the group's
  // last seq would durably record rows 2..n as seen the moment row 1
  // committed — and a crash there loses them for good.
  for (const row of step.rows) {
    try {
      target.applySyncedEvents({ threadId: step.threadId, rows: [row], cursor: row.seq });
    } catch (individual) {
      deps.debug(`skipping a synced ${row.event.type}: ${messageOf(individual)}`);
      // Nothing committed this row's position, and every row before it is
      // settled — so move past it here, or the next pass replays the same
      // refusal forever.
      writeSyncCursor(deps.db, row.seq);
    }
  }
}

/** Page the log forward and apply everything this device did not write —
 *  the contract's own loop, over this platform's store. Returns false when
 *  the session ended. */
function pullAndApply(deps: SyncPassDeps, context: PassContext): Promise<boolean> {
  return pullPages({
    client: context.client,
    deviceId: context.deviceId,
    fenced: () => deps.fenced(context),
    readCursor: () => readSyncState(deps.db).cursor,
    applyPlan: (steps) => {
      for (const step of steps) {
        if (step.kind === "apply") {
          applyStep(deps, step);
        } else {
          writeSyncCursor(deps.db, step.cursor);
        }
      }
    },
    recordFailure: (failure) => deps.recordFailure(failure),
    onPage: () => {
      deps.setLastError(null);
    },
    onSkipped: (message) => deps.debug(message),
  });
}

/**
 * Take the capture inbox, write what this device has not written before, and
 * ack.
 *
 * THE ORDER IS THE GUARANTEE, and it is worth being exact about which
 * guarantee, because the ledger closes one window and not the other.
 *
 * The vault write commits, THEN the id is recorded, THEN the claim is acked.
 * The window the ledger DOES close is the contract's own: a claim that lapses
 * after this device applied hands the same capture to whoever claims next,
 * and the ledger makes the second apply a no-op.
 *
 * The window it does NOT close is a crash between the vault write and the
 * ledger insert — two stores, no shared transaction, so there is no order
 * that makes both true at once. A process that dies in that gap writes the
 * bullet again when the capture is redelivered. That direction is CHOSEN:
 * recording first would instead lose the capture outright, and
 * `@repo/api/cloud/captures/captures-schema` states the trade plainly — a lost capture
 * is unrecoverable, a duplicated one is a line a reader deletes.
 */
async function applyCaptures(deps: SyncPassDeps, context: PassContext): Promise<boolean> {
  if (!deps.fenced(context)) {
    return false;
  }
  const claimed = await context.client.claimCaptures(CLAIM_DEFAULT_LIMIT);
  // A claim belongs to the account that granted it, and what follows WRITES
  // THE VAULT — the one step here whose side effect outlives the session.
  if (!deps.fenced(context)) {
    return false;
  }
  if (!claimed.ok) {
    return deps.recordFailure(claimed.failure) === "continue";
  }
  const captures = claimed.value.captures;
  if (captures.length === 0) {
    return true;
  }
  const fresh = unappliedCaptureIds(
    deps.db,
    captures.map((capture) => capture.id),
  );
  const toWrite = captures.filter((capture) => fresh.has(capture.id));
  if (toWrite.length > 0) {
    const written = await appendToInbox(deps.vault, toWrite);
    if (!deps.fenced(context)) {
      return false;
    }
    if (!written.applied) {
      // Nothing recorded and nothing acked: the claim lapses and the inbox
      // hands these to whoever claims next.
      deps.debug(written.reason);
      return true;
    }
    recordAppliedCaptures(
      deps.db,
      toWrite.map((capture) => capture.id),
      Date.now(),
    );
  }
  const acked = await context.client.ackCaptures({
    claimToken: claimed.value.claimToken,
    ids: captures.map((capture) => capture.id),
  });
  if (!deps.fenced(context)) {
    return false;
  }
  if (!acked.ok) {
    return deps.recordFailure(acked.failure) === "continue";
  }
  for (const outcome of acked.value.results) {
    if (outcome.outcome === "reclaimed") {
      deps.debug(`capture ${outcome.id} was reclaimed before this device acked it`);
    }
  }
  pruneAppliedCaptures(deps.db, Date.now() - APPLIED_CAPTURE_RETENTION_MS);
  return true;
}

/** One pass, in the one order: drain, page-and-apply, captures. */
export async function runSyncPass(deps: SyncPassDeps, context: PassContext): Promise<void> {
  if (!(await drain(deps, context))) {
    return;
  }
  if (!(await pullAndApply(deps, context))) {
    return;
  }
  if (!(await applyCaptures(deps, context))) {
    return;
  }
  if (!deps.fenced(context)) {
    return;
  }
  // "Checked" is a different fact from "caught up": a device with nothing to
  // pull is up to date, and a status that only moved on new rows would read
  // as stale forever on a quiet account.
  touchSyncedAt(deps.db, Date.now());
}
