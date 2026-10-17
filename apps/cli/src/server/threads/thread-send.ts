import { threadHasEvents, threadHoldsDispatch } from "@repo/db/events";
import { createTurnId } from "@repo/db/ids";
import {
  claimNextQueuedThreadMessageInTransaction,
  createQueuedThreadMessageInTransaction,
  deleteClaimedQueuedThreadMessageInTransaction,
} from "@repo/db/queued-messages";
import type { ClaimedQueuedThreadMessageRow } from "@repo/db/queued-messages";
import {
  applyThreadLifecycleEventInTransaction,
  ensureThreadInTransaction,
  getThread,
} from "@repo/db/threads";
import type { ThreadOriginInput, ThreadRow } from "@repo/db/threads";
import type { ThreadEvent } from "@repo/domain/provider-event";
import { threadScope } from "@repo/domain/thread-event-scope";
import { ACTION_PRESET_LABELS } from "@repo/domain/action-preset";
import type { DocViewContext, ViewContext } from "@repo/domain/view-context";
import type { SendMessageRequest } from "@repo/contract/local/threads/threads-schema";
import { nameThreadFromRequestsInTransaction } from "./thread-ingest";
import type { ThreadWrite } from "./thread-ingest";
import { turnRunsElsewhere } from "./thread-queries";
import type { TurnRequest } from "./turn-driver";

// threads-router switches exhaustively over this, so a new member breaks there rather than becoming a 500.
const SEND_CONFLICT_CODES = ["stale_turn", "archived"] as const;

type SendConflictCode = (typeof SEND_CONFLICT_CODES)[number];

export type SendOutcome =
  | { kind: "started"; turnId: string }
  | { kind: "queued"; queuedMessageId: string }
  | { kind: "not-found" }
  | { kind: "conflict"; error: SendConflictCode; message: string }
  | { kind: "provider-unavailable"; message: string }
  | { kind: "dispatch-failed" };

type QueuedSendOutcome = Extract<SendOutcome, { kind: "queued" }>;

// a phone's request as a Mac claimed it: its id is the phone's, and so is the thread's, which a
// new thread takes rather than one minted here
export interface DispatchedTurn {
  id: string;
  threadId: string;
  text: string;
  originDocPath?: string | undefined;
  // a phone describes a doc alone: it has no library grid
  viewContext?: DocViewContext | undefined;
}

// delivered: this device took it into the thread now, started, queued, or recorded beside the
// failure it met; held: this device already holds it, from a claim that lapsed or another Mac's
// request pulled first; refused: this device will not, in words the phone shows.
export type DispatchOutcome =
  | { kind: "delivered" }
  | { kind: "held" }
  | { kind: "refused"; message: string };

// what a send addresses: the thread, the turn it expects to be open, and what the turn carries.
interface SendTarget {
  threadId: string;
  expectedTurnId?: string | undefined;
  turn: TurnRequest;
}

export type SendDecision =
  | {
      kind: "dispatch";
      threadId: string;
      turnId: string;
      turn: TurnRequest;
    }
  // the queue's head starts, and the send that found it answers for its own message, queued behind it.
  | { kind: "drain"; claimed: ClaimedQueuedThreadMessageRow; outcome: QueuedSendOutcome }
  | { kind: "done"; outcome: SendOutcome };

type DispatchDecision =
  | { kind: "send"; send: SendDecision }
  | Exclude<DispatchOutcome, { kind: "delivered" }>;

// a phone's refusals, in the words its thread shows
const ARCHIVED_REFUSAL = "That action is archived.";
// queued here it would never start: a settle pulled from the device running the turn does not drain
// this device's queue
const RUNS_ELSEWHERE_REFUSAL =
  "That action is running on another computer. Ask again once it finishes.";

// a queued message carries no view context: it drains minutes later, long
// after the screen it described; storing one gives away the immediacy that keeps it honest. its
// context paths and its preset stay: an @-mention and a named action are part of what the user asked.
const queueInTransaction = (
  write: ThreadWrite,
  threadId: string,
  turn: TurnRequest,
): QueuedSendOutcome => {
  const queued = createQueuedThreadMessageInTransaction(write.tx, {
    contextPaths: turn.contextPaths ?? null,
    dispatchId: turn.dispatchId ?? null,
    preset: turn.preset ?? null,
    text: turn.text,
    threadId,
  });
  write.buffer.notifyThread(threadId, ["queue-changed"]);
  return { kind: "queued", queuedMessageId: queued.id };
};

const queuedTurn = (claimed: ClaimedQueuedThreadMessageRow): TurnRequest => {
  const turn: TurnRequest = { text: claimed.text };
  if (claimed.contextPaths !== null) {
    turn.contextPaths = claimed.contextPaths;
  }
  if (claimed.preset !== null) {
    turn.preset = claimed.preset;
  }
  if (claimed.dispatchId !== null) {
    turn.dispatchId = claimed.dispatchId;
  }
  return turn;
};

// a send's request also carries its routing (the thread, the turn it expects), which is no part of
// what the turn carries to the driver. a preset sent with no text is stored as its label, so the
// thread reads what was asked and names itself after it.
const requestedTurn = (request: SendMessageRequest): TurnRequest => ({
  contextPaths: request.contextPaths,
  preset: request.preset,
  text:
    request.text === "" && request.preset !== undefined
      ? ACTION_PRESET_LABELS[request.preset]
      : request.text,
  viewContext: request.viewContext,
});

// what the request event records of the screen: the library's scope, filters and count, never
// the selection's names. the event rides the thread sync under a 64 KiB cap that 200 long paths
// would pass, and only the turn's prompt reads them, through the TurnRequest that keeps them.
const recordedViewContext = (context: ViewContext): ViewContext =>
  context.surface === "library" ? { ...context, paths: [] } : context;

type ThreadMetaEvent = Extract<ThreadEvent, { type: "thread/meta" }>;

// what a thread is as its first request leaves it: the name that request gave it and the note it
// was started over. its harness is stated once a provider starts a turn on it.
const threadIdentity = (row: ThreadRow): ThreadMetaEvent | null => {
  const meta: ThreadMetaEvent = { scope: threadScope(), threadId: row.id, type: "thread/meta" };
  if (row.title !== null) {
    meta.title = row.title;
  }
  if (row.originDocPath !== null) {
    meta.originDocPath = row.originDocPath;
    if (row.originNoteId !== null) {
      meta.originNoteId = row.originNoteId;
    }
  }
  return meta.title === undefined && meta.originDocPath === undefined ? null : meta;
};

// takes the loaded row: the dispatch must carry what this transaction read, not what a second query could observe.
const prepareTurnInTransaction = (
  write: ThreadWrite,
  thread: ThreadRow,
  turn: TurnRequest,
): SendDecision => {
  const threadId = thread.id;
  const outcome = applyThreadLifecycleEventInTransaction(write.tx, {
    event: { type: "run.preparing" },
    threadId,
  });
  if (!outcome.applied) {
    // the drain's case: an archive landed between the settle and the claim.
    return {
      kind: "done",
      outcome: {
        error: "stale_turn",
        kind: "conflict",
        message: `Cannot start a turn: ${outcome.detail}`,
      },
    };
  }
  write.buffer.notifyThread(threadId, ["status-changed"]);
  const requested: Extract<ThreadEvent, { type: "client/turn/requested" }> = {
    scope: threadScope(),
    text: turn.text,
    threadId,
    type: "client/turn/requested",
  };
  if (turn.contextPaths !== undefined) {
    requested.contextPaths = [...turn.contextPaths];
  }
  if (turn.viewContext !== undefined) {
    requested.viewContext = recordedViewContext(turn.viewContext);
  }
  if (turn.dispatchId !== undefined) {
    requested.dispatchId = turn.dispatchId;
  }
  const firstRequest = !threadHasEvents(write.tx, threadId);
  write.appendLocal([requested]);
  write.buffer.notifyThread(threadId, ["events-appended"]);
  nameThreadFromRequestsInTransaction(write, threadId, [requested]);
  // after the naming, so the identity carries the title this request gave the thread.
  const named = firstRequest ? getThread(write.tx, threadId) : null;
  const identity = named === null ? null : threadIdentity(named);
  if (identity !== null) {
    write.appendLocal([identity]);
  }
  return {
    kind: "dispatch",
    threadId,
    turn,
    turnId: createTurnId(),
  };
};

const resolveSendInTransaction = (write: ThreadWrite, target: SendTarget): SendDecision => {
  const thread = getThread(write.tx, target.threadId);
  if (thread === null) {
    return { kind: "done", outcome: { kind: "not-found" } };
  }
  if (thread.archivedAt !== null) {
    return {
      kind: "done",
      outcome: { error: "archived", kind: "conflict", message: "The thread is archived" },
    };
  }
  if (target.expectedTurnId !== undefined && target.expectedTurnId !== thread.activeTurnId) {
    return {
      kind: "done",
      outcome: {
        error: "stale_turn",
        kind: "conflict",
        message: "The turn this message addressed is no longer the open one",
      },
    };
  }

  const { turn } = target;
  switch (thread.status) {
    case "idle":
    case "error": {
      // a message left in line (a restart, a remote settle, a failed dispatch) goes
      // first: starting this one ahead of it would run the older one after an unrelated turn.
      const head = claimNextQueuedThreadMessageInTransaction(write.tx, thread.id);
      if (head === null) {
        return prepareTurnInTransaction(write, thread, turn);
      }
      return {
        claimed: head,
        kind: "drain",
        outcome: queueInTransaction(write, thread.id, turn),
      };
    }
    case "active":
    case "starting":
    case "stopping": {
      return { kind: "done", outcome: queueInTransaction(write, thread.id, turn) };
    }
    // no default
  }
};

export const resolveMessageInTransaction = (
  write: ThreadWrite,
  request: SendMessageRequest,
): SendDecision =>
  resolveSendInTransaction(write, {
    expectedTurnId: request.expectedTurnId,
    threadId: request.threadId,
    turn: requestedTurn(request),
  });

export const resolveDispatchInTransaction = (
  write: ThreadWrite,
  dispatch: DispatchedTurn,
  origin: ThreadOriginInput | undefined,
): DispatchDecision => {
  const { threadId } = dispatch;
  if (threadHoldsDispatch(write.tx, { dispatchId: dispatch.id, threadId })) {
    return { kind: "held" };
  }
  const ensured = ensureThreadInTransaction(write.tx, threadId, origin);
  if (ensured.created) {
    write.buffer.notifyThread(threadId, ["thread-created"]);
  }
  if (ensured.row.archivedAt !== null) {
    return { kind: "refused", message: ARCHIVED_REFUSAL };
  }
  if (turnRunsElsewhere(write.tx, ensured.row)) {
    return { kind: "refused", message: RUNS_ELSEWHERE_REFUSAL };
  }
  const turn: TurnRequest = { dispatchId: dispatch.id, text: dispatch.text };
  if (dispatch.viewContext !== undefined) {
    turn.viewContext = dispatch.viewContext;
  }
  return { kind: "send", send: resolveSendInTransaction(write, { threadId, turn }) };
};

export const dispatchOutcomeOf = (threadId: string, outcome: SendOutcome): DispatchOutcome => {
  switch (outcome.kind) {
    case "conflict": {
      return { kind: "refused", message: outcome.message };
    }
    case "not-found": {
      throw new Error(`thread ${threadId} vanished inside the dispatch that ensured it`);
    }
    // the request is in the thread; a failure to run it is a row the phone reads there
    case "started":
    case "queued":
    case "provider-unavailable":
    case "dispatch-failed": {
      return { kind: "delivered" };
    }
    // no default
  }
};

// the queue row and its request event are one transaction: deleting after
// the dispatch would let a refused start release the row and the next drain
// append the message a second time, on every signed-in device.
export const prepareQueuedTurnInTransaction = (
  write: ThreadWrite,
  threadId: string,
  claimed: ClaimedQueuedThreadMessageRow,
): SendDecision => {
  const thread = getThread(write.tx, threadId);
  if (thread === null) {
    return { kind: "done", outcome: { kind: "not-found" } };
  }
  const prepared = prepareTurnInTransaction(write, thread, queuedTurn(claimed));
  if (prepared.kind === "dispatch") {
    deleteClaimedQueuedThreadMessageInTransaction(write.tx, claimed);
    write.buffer.notifyThread(threadId, ["queue-changed"]);
  }
  return prepared;
};
