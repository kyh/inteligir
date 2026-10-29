// The account's one built-in turn as its rows move, each move inside one of the cell's
// transactions: a send claims the turn or waits behind it, an event the cell stores moves the turn
// by what it means (an approval it waits on, an answer to one, its end), and a turn whose session
// is confirmed at rest seals its change set, lets its thread rest and hands the turn to the send
// that has waited longest. What a move asks for later is a job, so it outlives the cell's isolate:
// the open turn's reconcile, an unanswered approval's limit, the queue's next start, a session to
// delete at Anthropic.

import { z } from "zod";

import type { SqlStatements } from "@repo/notes/library/library-sql";

import { sealChangeSet } from "../library/change-sets";
import { dropJob, scheduleJob } from "../library/cell-jobs";
import type { LandingScope } from "../library/cell-landing";
import type { CellResult } from "../library/cell-refusal";
import { deleteThread } from "../library/cell-threads";
import type { Built, WriteRequest } from "../library/library-engine";
import type { AgentCell } from "./agent-access";
import { agentIsOn } from "./agent-access";
import { bookTurn } from "./agent-allowance";
import { keepEvent, signalOf } from "./turn-events";
import type { StreamEvent, ThreadEventRow, TurnSignal } from "./turn-events";
import {
  dequeue,
  dropQueue,
  dropSession,
  dropTurn,
  insertTurn,
  knownThread,
  nextTurnNumber,
  openTurn,
  queuedFor,
  queueWaits,
  requeueFirst,
  setThreadSession,
  setThreadStatus,
  setTurnAwaiting,
  setTurnEnding,
  setTurnRunning,
  threadSpoke,
  threadState,
} from "./turn-rows";
import type { OpenTurn, ThreadStatus, TurnMessage, TurnPhase } from "./turn-rows";

// the open turn reconciled again this long after the last, while it is open: the platform's
// webhook and the stream are the quick ways a turn moves, and this the one that never misses
export const RECONCILE_EVERY_MS = 60_000;
// a turn whose start has not landed this long after it began was cut short, and starts again
export const START_LEASE_MS = 2 * 60_000;
// an approval nobody answered is denied this long after the session asked
export const APPROVAL_LIMIT_MS = 10 * 60_000;
// a send waiting whose turn could not start is tried again this long after
const QUEUE_AGAIN_MS = 60_000;

export const TURN_JOB = { id: "agent-turn", kind: "agent-turn", payload: "{}" } as const;
export const APPROVAL_JOB = {
  id: "agent-approval",
  kind: "agent-approval",
  payload: "{}",
} as const;
const QUEUE_JOB = { id: "agent-queue", kind: "agent-queue", payload: "{}" } as const;

const forgetJob = (sessionId: string) =>
  ({
    id: `agent-forget:${sessionId}`,
    kind: "agent-forget",
    payload: JSON.stringify({ sessionId }),
  }) as const;

export const forgetPayloadSchema = z.object({ sessionId: z.string().min(1) });

// one transaction of the turn's own, the library's new head told to the sockets and the alarm set
// to the jobs it asked for; a call of the person's lets its procedure settle instead
export const landTurn = async <S extends z.ZodType>(
  cell: AgentCell,
  request: WriteRequest<S>,
  work: (scope: LandingScope) => Built<z.input<S>>,
): Promise<CellResult<z.output<S>>> => {
  const landed = cell.library.landApart(request, work);
  if (landed.ok && landed.head !== null) {
    cell.tell({ head: landed.head, type: "library" });
  }
  await cell.scheduleAlarm();
  return landed;
};

// ---- the thread ----

// where a thread rests between turns: behind a send of its own still waiting, stopped once its
// session ended, else idle
const restingStatus = (sql: SqlStatements, threadId: string): ThreadStatus => {
  if (queuedFor(sql, threadId) > 0) {
    return "queued";
  }
  const held = threadState(sql, threadId);
  return held?.session_id === null && threadSpoke(sql, threadId) ? "stopped" : "idle";
};

export const restThread = (scope: LandingScope, threadId: string): void => {
  if (threadState(scope.storage, threadId) !== null) {
    setThreadStatus(scope, threadId, restingStatus(scope.storage, threadId));
  }
};

// a session the thread runs in no more, deleted at Anthropic by its job: once its turn reached the
// allowance, its session ended, or the thread went
export const letSessionGo = (scope: LandingScope, threadId: string, sessionId: string): void => {
  if (threadState(scope.storage, threadId)?.session_id === sessionId) {
    setThreadSession(scope, threadId, null);
  }
  dropSession(scope.storage, sessionId, scope.now);
  scheduleJob(scope.storage, forgetJob(sessionId), scope.now);
};

// ---- claiming the turn ----

// the turn, the send's: counted against the day as it begins, its thread running, and its
// reconcile asked for, which starts it again if this start is cut short
export const claimTurn = (
  scope: LandingScope,
  send: { readonly threadId: string; readonly message: TurnMessage },
): void => {
  const thread = knownThread(scope.storage, send.threadId);
  insertTurn(scope.storage, {
    message: send.message,
    sessionId: thread.session_id,
    startedAt: scope.now,
    threadId: send.threadId,
    turn: nextTurnNumber(scope.storage, send.threadId),
  });
  bookTurn(scope.storage, scope.now, 1);
  setThreadStatus(scope, send.threadId, "running");
  scheduleJob(scope.storage, TURN_JOB, scope.now + RECONCILE_EVERY_MS);
};

// the turn handed to the send that waited longest, its thread's id, or null with none waiting or a
// turn open; an agent turned off lets every waiting send go
export const claimNext = (scope: LandingScope): string | null => {
  const { storage } = scope;
  if (openTurn(storage) !== null) {
    return null;
  }
  dropJob(storage, QUEUE_JOB.id);
  if (!agentIsOn(storage)) {
    for (const threadId of dropQueue(storage)) {
      restThread(scope, threadId);
    }
    return null;
  }
  const next = dequeue(storage);
  if (next === null) {
    return null;
  }
  claimTurn(scope, next);
  return next.threadId;
};

// a turn whose start did not land, taken back: not counted, its session let go of if this start
// made it, and its send back at the head of the queue, or, for a send the person still waits on,
// gone with the thread it made
export const unclaimTurn = (
  scope: LandingScope,
  undo: {
    readonly made: string | null;
    readonly requeueAs: string | null;
    readonly opId: string | undefined;
  },
): void => {
  const { storage } = scope;
  const turn = openTurn(storage);
  if (turn?.phase !== "starting") {
    return;
  }
  dropTurn(storage);
  dropJob(storage, TURN_JOB.id);
  bookTurn(storage, scope.now, -1);
  if (undo.made !== null) {
    letSessionGo(scope, turn.threadId, undo.made);
  }
  if (undo.requeueAs !== null) {
    requeueFirst(storage, turn, undo.requeueAs);
  }
  if (undo.opId !== undefined) {
    storage.run("DELETE FROM applied_ops WHERE op_id = ?", [undo.opId]);
  }
  if (
    undo.requeueAs === null &&
    !threadSpoke(storage, turn.threadId) &&
    queuedFor(storage, turn.threadId) === 0
  ) {
    deleteThread(scope, turn.threadId);
  } else {
    restThread(scope, turn.threadId);
  }
  if (queueWaits(storage)) {
    scheduleJob(storage, QUEUE_JOB, scope.now + QUEUE_AGAIN_MS);
  }
};

// ---- an event, kept ----

// the answer to some of the calls the session waits on: once none waits, the turn runs again
export const settleApprovals = (
  scope: LandingScope,
  turn: OpenTurn,
  eventIds: readonly string[],
): void => {
  const answered = new Set(eventIds);
  const waiting = turn.pending.filter((id) => !answered.has(id));
  if (waiting.length > 0) {
    setTurnAwaiting(scope.storage, waiting, scope.now);
    return;
  }
  setTurnRunning(scope.storage);
  setThreadStatus(scope, turn.threadId, "running");
  dropJob(scope.storage, APPROVAL_JOB.id);
};

const applySignal = (scope: LandingScope, turn: OpenTurn, signal: TurnSignal): void => {
  if (signal.kind === "approval" && signal.eventIds.length > 0 && turn.phase === "running") {
    setTurnAwaiting(scope.storage, signal.eventIds, scope.now);
    setThreadStatus(scope, turn.threadId, "awaiting_approval");
    scheduleJob(scope.storage, APPROVAL_JOB, scope.now + APPROVAL_LIMIT_MS);
  } else if (
    signal.kind === "confirmed" &&
    turn.phase === "awaiting_approval" &&
    turn.pending.includes(signal.toolUseId)
  ) {
    settleApprovals(scope, turn, [signal.toolUseId]);
  } else if (signal.kind === "end" && turn.phase !== "ending") {
    setTurnEnding(scope.storage, signal.reason);
    dropJob(scope.storage, APPROVAL_JOB.id);
  }
};

// where the session's turn stands after an event: one of its phases, or gone once no turn of the
// session's is open
export type TurnState = TurnPhase | "gone";

export const turnStateOf = (sql: SqlStatements, sessionId: string): TurnState => {
  const turn = openTurn(sql);
  return turn?.sessionId === sessionId ? turn.phase : "gone";
};

// the event kept as its thread's, once, and the open turn moved by it when the turn is its
// session's: its row and what it meant, or null for one kept before
export const absorbEvent = (
  scope: LandingScope,
  where: { readonly threadId: string; readonly sessionId: string },
  event: StreamEvent,
): { readonly row: ThreadEventRow; readonly signal: TurnSignal } | null => {
  const row = keepEvent(scope, where, event);
  if (row === null) {
    return null;
  }
  const signal = signalOf(event);
  const turn = openTurn(scope.storage);
  if (turn !== null && turn.sessionId === where.sessionId && turn.phase !== "starting") {
    applySignal(scope, turn, signal);
  }
  return { row, signal };
};

// ---- the seal ----

const setIdSchema = z.object({ id: z.string() });

// the change set the turn's writes opened, sealed; a turn that wrote nothing opened none
export const sealTurnSet = (
  sql: SqlStatements,
  turn: Pick<OpenTurn, "threadId" | "turn">,
  now: number,
): void => {
  for (const raw of sql.all(
    `SELECT id FROM change_sets WHERE actor = 'agent' AND sealed_at IS NULL AND thread_id = ?
     AND turn = ?`,
    [turn.threadId, turn.turn],
  )) {
    sealChangeSet(sql, setIdSchema.parse(raw).id, now);
  }
};

// the ending turn, sealed once its session is confirmed at rest: its change set closed, its
// session let go of if it reached the allowance or ended, its thread at rest, and the turn handed
// to the next send waiting, whose thread's id it answers
export const sealTurn = (
  scope: LandingScope,
  expected: Pick<OpenTurn, "threadId" | "turn">,
): string | null => {
  const { storage } = scope;
  const turn = openTurn(storage);
  if (
    turn?.phase !== "ending" ||
    turn.threadId !== expected.threadId ||
    turn.turn !== expected.turn
  ) {
    return null;
  }
  sealTurnSet(storage, turn, scope.now);
  dropTurn(storage);
  dropJob(storage, TURN_JOB.id);
  dropJob(storage, APPROVAL_JOB.id);
  if ((turn.ends === "budget_reached" || turn.ends === "terminated") && turn.sessionId !== null) {
    letSessionGo(scope, turn.threadId, turn.sessionId);
  }
  restThread(scope, turn.threadId);
  return claimNext(scope);
};
