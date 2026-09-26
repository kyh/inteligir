// every step re-checks its session after every await, before any write. the
// cursor moves inside the apply's transaction: a separate advance is the window
// a crash duplicates a conversation through.

import { CLAIM_DEFAULT_LIMIT } from "@repo/api/cloud/captures/captures-schema";
import { describeCloudFailure } from "@repo/api/cloud/client";
import type { CloudClient, CloudFailure } from "@repo/api/cloud/client";
import { DISPATCH_CLAIM_DEFAULT_LIMIT } from "@repo/api/cloud/dispatch/dispatch-schema";
import type { DispatchResult } from "@repo/api/cloud/dispatch/dispatch-schema";
import { SYNC_OUTBOX_CODES } from "@repo/api/cloud/errors";
import type { LogPlanStep } from "@repo/api/cloud/sync/plan-page";
import { pullPages } from "@repo/api/cloud/sync/sync-session";
import type { SyncOutcome } from "@repo/api/cloud/sync/sync-session";
import { writeTransaction } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { MissingTurnStartedError } from "@repo/db/events";
import type { SyncedEventInput } from "@repo/db/events";
import { setInteractionRelay } from "@repo/db/pending-interactions";
import {
  countSyncOutbox,
  dropSyncOutboxThrough,
  pruneAppliedCaptures,
  readSyncState,
  recordAppliedCaptures,
  recordSkippedRow,
  touchSyncedAt,
  unappliedCaptureIds,
  writeSyncCursor,
} from "@repo/db/sync-outbox";
import type { DebugLog } from "../debug-log";
import { messageOf } from "../error-message";
import { ThreadEventThreadIdMismatchError } from "../threads/thread-event-mismatch-error";
import { appendToInbox, APPLIED_CAPTURE_RETENTION_MS } from "./captures";
import type { CaptureVault } from "./captures";
import { applyDispatch, approvalsToClose, approvalsToOpen } from "./dispatches";
import type { DispatchSink } from "./dispatches";
import { ackPushBatch, takePushBatch } from "./outbox";

// bounds one pass's drain so a backlog cannot starve the pull half or hold a shutdown open.
const MAX_PUSH_BATCHES_PER_PASS = 25;

// implemented by ThreadService alone — a second append path is a second answer to thread lifecycle.
export interface SyncedEventSink extends DispatchSink {
  applySyncedEvents: (args: {
    threadId: string;
    /** each event with the log row's own identity, so the append is idempotent on it. */
    rows: readonly SyncedEventInput[];
    /** written in the same transaction that appends. */
    cursor: number;
  }) => void;
}

// captured once at the top of a pass so no step reads a newer session.
export interface PassContext {
  sessionId: number;
  client: CloudClient;
  ownDeviceIds: ReadonlySet<string>;
}

export interface SyncPassDeps {
  db: DbConnection;
  /** the running build, recorded beside a row it could not read so a different one pulls it again. */
  build: string;
  vault: CaptureVault;
  debug: (message: string) => void;
  /** INTELIGIR_DEBUG's sync trace: where each step of a pass stopped, and each pulled page. */
  debugLog?: DebugLog | undefined;
  /** late-bound: the thread service is built after the runtime. */
  sink: () => SyncedEventSink | null;
  /** checked after every await, before any write. */
  fenced: (context: PassContext) => boolean;
  /** read per pass: off, this Mac claims nothing from the dispatch inbox. */
  phoneRequests: () => boolean;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
  setLastError: (message: string | null) => void;
}

// a retryable failure leaves the pass to carry on with its other steps; a terminal one has ended
// the session, which fences the rest.
const failedOrFenced = (deps: SyncPassDeps, failure: CloudFailure): SyncOutcome =>
  deps.recordFailure(failure) === "continue" ? "failed" : "fenced";

// an outbox refusal is not retried: the log already holds that position, so the
// row can never land and would wedge everything behind it. the local log keeps
// every event; only the cloud's copy is lost.
const drain = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  for (let round = 0; round < MAX_PUSH_BATCHES_PER_PASS; round += 1) {
    if (!deps.fenced(context)) {
      return "fenced";
    }
    const batch = takePushBatch(deps.db);
    if (batch === null) {
      return "caught-up";
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
      return "fenced";
    }
    if (!result.ok) {
      if (result.failure.kind === "refused" && SYNC_OUTBOX_CODES.has(result.failure.code)) {
        const through = result.failure.deviceSeq ?? batch.throughDeviceSeq;
        const dropped = dropSyncOutboxThrough(deps.db, through);
        deps.debug(
          `${result.failure.code} at position ${through}: dropped ${dropped} queued event(s) the log will not take`,
        );
        deps.setLastError(describeCloudFailure(result.failure));
        continue;
      }
      return failedOrFenced(deps, result.failure);
    }
    ackPushBatch(deps.db, batch);
  }
  return countSyncOutbox(deps.db) > 0 ? "more" : "caught-up";
};

const applyStep = (deps: SyncPassDeps, step: Extract<LogPlanStep, { kind: "apply" }>): void => {
  const target = deps.sink();
  if (target === null) {
    throw new Error("cloud sync has no ingest sink attached");
  }
  const groupCursor = step.rows.at(-1)?.seq;
  if (groupCursor === undefined) {
    return;
  }
  try {
    target.applySyncedEvents({ cursor: groupCursor, rows: step.rows, threadId: step.threadId });
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
      target.applySyncedEvents({ cursor: row.seq, rows: [row], threadId: step.threadId });
    } catch (error) {
      // only the log's own refusals of a row are skipped. anything else is this build's fault, and
      // moving the cursor past it would lose the row for good: it fails the pass instead, with the
      // cursor where the last commit left it and the error in the status.
      if (
        !(error instanceof MissingTurnStartedError) &&
        !(error instanceof ThreadEventThreadIdMismatchError)
      ) {
        throw error;
      }
      deps.debug(`skipping a synced ${row.event.type}: ${messageOf(error)}`);
      // nothing committed this row's position; move past it or the next pass replays the refusal forever.
      writeSyncCursor(deps.db, row.seq);
    }
  }
};

const skipStep = (deps: SyncPassDeps, step: Extract<LogPlanStep, { kind: "skip" }>): void => {
  const { firstUnparsed } = step;
  writeTransaction(deps.db, (tx) => {
    writeSyncCursor(tx, step.cursor);
    if (firstUnparsed !== null) {
      recordSkippedRow(tx, { build: deps.build, seq: firstUnparsed });
    }
  });
};

// a throw is a row that did not land, and applyStep's refusal to move the cursor past it: this
// step fails with the cursor where the last commit left it, and the captures still run.
const pullAndApply = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  try {
    return await pullPages({
      applyPlan: (steps) => {
        for (const step of steps) {
          if (step.kind === "apply") {
            applyStep(deps, step);
          } else {
            skipStep(deps, step);
          }
        }
      },
      client: context.client,
      debugLog: deps.debugLog,
      fenced: () => deps.fenced(context),
      onSkipped: (message) => {
        deps.debug(message);
      },
      ownDeviceIds: context.ownDeviceIds,
      readCursor: () => readSyncState(deps.db).cursor,
      recordFailure: (failure) => deps.recordFailure(failure),
    });
  } catch (error) {
    const message = messageOf(error);
    deps.setLastError(message);
    deps.debug(`applying the account's log failed: ${message}`);
    return "failed";
  }
};

// vault write, then ledger, then ack. the ledger closes the lapsed-claim window;
// a crash between the write and the ledger (two stores, no shared transaction)
// duplicates a bullet, and that direction is chosen: recording first would lose
// the capture outright.
const applyCaptures = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  if (!deps.fenced(context)) {
    return "fenced";
  }
  const claimed = await context.client.claimCaptures(CLAIM_DEFAULT_LIMIT);
  // what follows writes the vault — the one side effect that outlives the session.
  if (!deps.fenced(context)) {
    return "fenced";
  }
  if (!claimed.ok) {
    return failedOrFenced(deps, claimed.failure);
  }
  const { captures } = claimed.value;
  if (captures.length === 0) {
    return "caught-up";
  }
  const fresh = unappliedCaptureIds(
    deps.db,
    captures.map((capture) => capture.id),
  );
  const toWrite = captures.filter((capture) => fresh.has(capture.id));
  if (toWrite.length > 0) {
    const written = await appendToInbox(deps.vault, toWrite);
    if (!deps.fenced(context)) {
      return "fenced";
    }
    if (!written.applied) {
      // nothing recorded, nothing acked: the claim lapses and these are redelivered.
      deps.debug(written.reason);
      deps.setLastError(written.reason);
      return "failed";
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
    return "fenced";
  }
  if (!acked.ok) {
    return failedOrFenced(deps, acked.failure);
  }
  for (const outcome of acked.value.results) {
    if (outcome.outcome === "reclaimed") {
      deps.debug(`capture ${outcome.id} was reclaimed before this device acked it`);
    }
  }
  pruneAppliedCaptures(deps.db, Date.now() - APPLIED_CAPTURE_RETENTION_MS);
  // a full claim may have left more in the inbox behind it.
  return captures.length < CLAIM_DEFAULT_LIMIT ? "caught-up" : "more";
};

// after the pull, so a request another Mac already ran for a dispatch is here to be found. a row's
// ack waits for every row before it in the claim; one whose apply threw is left out, so its claim
// lapses and it comes back.
const applyDispatches = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  if (!deps.fenced(context)) {
    return "fenced";
  }
  let takesRequests: boolean;
  try {
    takesRequests = deps.phoneRequests();
  } catch (error) {
    // an unreadable choice is not taken as on: the person may have turned it off
    const message = messageOf(error);
    deps.setLastError(message);
    deps.debug(`reading whether this Mac takes phone requests failed: ${message}`);
    return "failed";
  }
  if (!takesRequests) {
    return "caught-up";
  }
  const sink = deps.sink();
  if (sink === null) {
    throw new Error("cloud sync has no ingest sink attached");
  }
  const claimed = await context.client.claimDispatches(DISPATCH_CLAIM_DEFAULT_LIMIT);
  if (!deps.fenced(context)) {
    return "fenced";
  }
  if (!claimed.ok) {
    return failedOrFenced(deps, claimed.failure);
  }
  const { claimToken, dispatches } = claimed.value;
  const results: DispatchResult[] = [];
  let failed = false;
  for (const dispatch of dispatches) {
    // a turn run under a session that has ended would be enqueued into the next one's outbox
    if (!deps.fenced(context)) {
      return "fenced";
    }
    try {
      results.push(await applyDispatch(sink, deps.db, dispatch));
    } catch (error) {
      failed = true;
      const message = messageOf(error);
      deps.setLastError(message);
      deps.debug(`applying phone request ${dispatch.id} failed: ${message}`);
    }
  }
  if (results.length > 0) {
    if (!deps.fenced(context)) {
      return "fenced";
    }
    const acked = await context.client.ackDispatches({ claimToken, results });
    if (!deps.fenced(context)) {
      return "fenced";
    }
    if (!acked.ok) {
      return failedOrFenced(deps, acked.failure);
    }
    for (const outcome of acked.value.results) {
      if (outcome.outcome !== "recorded") {
        deps.debug(
          `phone request ${outcome.id} was ${outcome.outcome} before this device acked it`,
        );
      }
    }
  }
  if (failed) {
    return "failed";
  }
  // a full claim may have left more in the inbox behind it.
  return dispatches.length < DISPATCH_CLAIM_DEFAULT_LIMIT ? "caught-up" : "more";
};

// a phone-started turn's approval is offered to the phone while it waits here, and taken back once
// it settles here, however it settled. each mark follows the inbox's answer, so an answer lost on
// the way is asked again, under the same id.
const relayApprovals = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  for (const approval of approvalsToOpen(deps.db)) {
    if (!deps.fenced(context)) {
      return "fenced";
    }
    const opened = await context.client.openApproval(approval.request);
    if (!deps.fenced(context)) {
      return "fenced";
    }
    if (!opened.ok) {
      return failedOrFenced(deps, opened.failure);
    }
    setInteractionRelay(
      deps.db,
      approval.interactionId,
      opened.value.state === "closed" ? "closed" : "opened",
    );
  }
  for (const approval of approvalsToClose(deps.db)) {
    if (!deps.fenced(context)) {
      return "fenced";
    }
    const closed = await context.client.closeApproval(approval.approvalId);
    if (!deps.fenced(context)) {
      return "fenced";
    }
    if (!closed.ok) {
      return failedOrFenced(deps, closed.failure);
    }
    // unknown too: the inbox holds nothing left to close
    setInteractionRelay(deps.db, approval.interactionId, "closed");
  }
  return "caught-up";
};

const PASS_STEPS = [
  ["push", drain],
  ["pull", pullAndApply],
  ["captures", applyCaptures],
  ["dispatch", applyDispatches],
  ["approvals", relayApprovals],
] as const;

// a failed step does not stop the ones after it: an unreachable push says nothing about the pull.
// only a pass whose every step reached the cloud and left nothing behind is stamped synced — a
// quiet account included, since "checked" is the claim, or it would read as stale forever.
export const runSyncPass = async (
  deps: SyncPassDeps,
  context: PassContext,
): Promise<SyncOutcome> => {
  const outcomes: SyncOutcome[] = [];
  for (const [name, step] of PASS_STEPS) {
    const outcome = await step(deps, context);
    deps.debugLog?.(`session ${context.sessionId} ${name}: ${outcome}`);
    if (outcome === "fenced") {
      return outcome;
    }
    outcomes.push(outcome);
  }
  if (!deps.fenced(context)) {
    return "fenced";
  }
  // cleared once per pass, never per step: a later step's success would hide an earlier one's failure.
  if (!outcomes.includes("failed")) {
    deps.setLastError(null);
  }
  if (outcomes.includes("more")) {
    return "more";
  }
  if (outcomes.includes("failed")) {
    return "failed";
  }
  touchSyncedAt(deps.db, Date.now());
  return "caught-up";
};
