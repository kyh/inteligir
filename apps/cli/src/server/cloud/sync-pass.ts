// every step re-checks its session after every await, before any write. the
// cursor moves inside the apply's transaction: a separate advance is the window
// a crash duplicates a conversation through.

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

// bounds one pass's drain so a backlog cannot starve the pull half or hold a shutdown open.
const MAX_PUSH_BATCHES_PER_PASS = 25;

// implemented by ThreadService alone — a second append path is a second answer to thread lifecycle.
export interface SyncedEventSink {
  applySyncedEvents(args: {
    threadId: string;
    /** each event with the log row's own identity, so the append is idempotent on it. */
    rows: readonly SyncedEventInput[];
    /** written in the same transaction that appends. */
    cursor: number;
  }): void;
}

// captured once at the top of a pass so no step reads a newer session.
export interface PassContext {
  sessionId: number;
  client: CloudClient;
  deviceId: string;
}

export interface SyncPassDeps {
  db: DbConnection;
  vault: CaptureVault;
  debug(message: string): void;
  /** late-bound: the thread service is built after the runtime. */
  sink(): SyncedEventSink | null;
  /** checked after every await, before any write. */
  fenced(context: PassContext): boolean;
  recordFailure(failure: CloudFailure): "continue" | "ended";
  setLastError(message: string | null): void;
}

// an outbox refusal is not retried: the log already holds that position, so the
// row can never land and would wedge everything behind it. the local log keeps
// every event; only the cloud's copy is lost.
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
    // the ack deletes rows; a sign-in mid-flight re-numbered the queue, so an old session's ack deletes new work.
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
  // one at a time so a refused event (a turn-content event whose turn/started
  // never arrived) does not take the group down. each retry commits its own
  // row's position: the group's last seq would record rows 2..n as seen the
  // moment row 1 committed.
  for (const row of step.rows) {
    try {
      target.applySyncedEvents({ threadId: step.threadId, rows: [row], cursor: row.seq });
    } catch (individual) {
      deps.debug(`skipping a synced ${row.event.type}: ${messageOf(individual)}`);
      // nothing committed this row's position; move past it or the next pass replays the refusal forever.
      writeSyncCursor(deps.db, row.seq);
    }
  }
}

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

// vault write, then ledger, then ack. the ledger closes the lapsed-claim window;
// a crash between the write and the ledger (two stores, no shared transaction)
// duplicates a bullet, and that direction is chosen: recording first would lose
// the capture outright.
async function applyCaptures(deps: SyncPassDeps, context: PassContext): Promise<boolean> {
  if (!deps.fenced(context)) {
    return false;
  }
  const claimed = await context.client.claimCaptures(CLAIM_DEFAULT_LIMIT);
  // what follows writes the vault — the one side effect that outlives the session.
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
      // nothing recorded, nothing acked: the claim lapses and these are redelivered.
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
  // "checked" is not "caught up": a quiet account would otherwise read as stale forever.
  touchSyncedAt(deps.db, Date.now());
}
