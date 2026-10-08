// every step re-checks its session after every await, before any write. the
// cursor moves inside the apply's transaction: a separate advance is the window
// a crash duplicates a conversation through.

import { describeCloudFailure } from "@repo/contract/cloud/client";
import type { CloudClient, CloudFailure } from "@repo/contract/cloud/client";
import { DISPATCH_CLAIM_DEFAULT_LIMIT } from "@repo/contract/cloud/dispatch/dispatch-schema";
import type { DispatchResult } from "@repo/contract/cloud/dispatch/dispatch-schema";
import { SYNC_OUTBOX_CODES } from "@repo/contract/cloud/errors";
import type { LogPlanStep } from "@repo/contract/cloud/sync/plan-page";
import { pullPages } from "@repo/contract/cloud/sync/sync-session";
import type { SyncOutcome } from "@repo/contract/cloud/sync/sync-session";
import { writeTransaction } from "@repo/db/connection";
import type { DbConnection } from "@repo/db/connection";
import { MissingTurnStartedError } from "@repo/db/events";
import type { SyncedEventInput } from "@repo/db/events";
import { setInteractionRelay } from "@repo/db/pending-interactions";
import {
  countSyncOutbox,
  dropSyncOutboxThrough,
  readSyncState,
  recordSkippedRow,
  touchSyncedAt,
  writeSyncCursor,
} from "@repo/db/sync-outbox";
import type { DebugLog } from "../debug-log";
import { messageOf } from "../error-message";
import { ThreadEventThreadIdMismatchError } from "../threads/thread-event-mismatch-error";
import {
  applyDispatch,
  approvalsToClose,
  approvalsToOpen,
  approvalsToWithdraw,
} from "./dispatches";
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
  debug: (message: string) => void;
  /** INTELIGIR_DEBUG's sync trace: where each step of a pass stopped, and each pulled page. */
  debugLog?: DebugLog | undefined;
  /** late-bound: the thread service is built after the runtime. */
  sink: () => SyncedEventSink | null;
  /** checked after every await, before any write. */
  fenced: (context: PassContext) => boolean;
  /** read per pass: off, this Mac claims nothing from the dispatch inbox and offers no approval. */
  phoneRequests: () => boolean;
  recordFailure: (failure: CloudFailure) => "continue" | "ended";
  setLastError: (message: string | null) => void;
}

type PassStepName = "push" | "pull" | "dispatch" | "approvals";

// what the steps before one concluded, for a step that waits on another's work
type EarlierSteps = ReadonlyMap<PassStepName, SyncOutcome>;

type PassStep = (
  deps: SyncPassDeps,
  context: PassContext,
  earlier: EarlierSteps,
) => Promise<SyncOutcome>;

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
// step fails with the cursor where the last commit left it, and the steps after it still run.
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

// waits for a whole log, so a request another Mac already ran for a dispatch is here to be found
// and a follow-up lands in its thread rather than starting one the log already holds: a pull with
// more behind it runs the next pass at once, and a failed one leaves the row for a later pass or
// another Mac. a row's ack waits for every row before it in the claim; one whose apply threw is
// left out, so its claim lapses and it comes back.
const applyDispatches = async (
  deps: SyncPassDeps,
  context: PassContext,
  earlier: EarlierSteps,
): Promise<SyncOutcome> => {
  const pulled = earlier.get("pull") ?? "failed";
  if (pulled !== "caught-up") {
    return pulled;
  }
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
      results.push(applyDispatch(sink, deps.db, dispatch));
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
// it settles here, however it settled, or once this Mac stops taking the phone's requests, since it
// would never claim the answer. each mark follows the inbox's answer, so an answer lost on the way
// is asked again, under the same id.
const relayApprovals = async (deps: SyncPassDeps, context: PassContext): Promise<SyncOutcome> => {
  let takesRequests: boolean;
  try {
    takesRequests = deps.phoneRequests();
  } catch {
    // off, as the dispatch step takes it; that step reports what could not be read
    takesRequests = false;
  }
  for (const approval of takesRequests ? approvalsToOpen(deps.db) : []) {
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
  const toClose = takesRequests ? approvalsToClose(deps.db) : approvalsToWithdraw(deps.db);
  for (const approval of toClose) {
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

const PASS_STEPS: readonly (readonly [PassStepName, PassStep])[] = [
  ["push", drain],
  ["pull", pullAndApply],
  ["dispatch", applyDispatches],
  ["approvals", relayApprovals],
];

// a failed step does not stop the ones after it: an unreachable push says nothing about the pull.
// only a pass whose every step reached the cloud and left nothing behind is stamped synced — a
// quiet account included, since "checked" is the claim, or it would read as stale forever.
export const runSyncPass = async (
  deps: SyncPassDeps,
  context: PassContext,
): Promise<SyncOutcome> => {
  const concluded = new Map<PassStepName, SyncOutcome>();
  for (const [name, step] of PASS_STEPS) {
    const outcome = await step(deps, context, concluded);
    deps.debugLog?.(`session ${context.sessionId} ${name}: ${outcome}`);
    if (outcome === "fenced") {
      return outcome;
    }
    concluded.set(name, outcome);
  }
  const outcomes = new Set(concluded.values());
  if (!deps.fenced(context)) {
    return "fenced";
  }
  // cleared once per pass, never per step: a later step's success would hide an earlier one's failure.
  if (!outcomes.has("failed")) {
    deps.setLastError(null);
  }
  if (outcomes.has("more")) {
    return "more";
  }
  if (outcomes.has("failed")) {
    return "failed";
  }
  touchSyncedAt(deps.db, Date.now());
  return "caught-up";
};
