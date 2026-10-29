// The built-in agent's turns, as `library.agent.*` asks for them: one Managed Agents session per
// thread and at most one turn per account at a time, since a tool call carries the account's token
// and not the session's, so only the one open turn can own it. A send checks the day's allowance,
// then claims the turn or waits behind it; the turn starts at Anthropic (`./turn-start`), its
// stream is read while the cell stays up (`./turn-stream`), and its writes, every call the built-in
// client makes while it is open, join its one undoable change set. A paused call waits on the
// person (`respond`) for at most ten minutes; a cancel denies what waits and interrupts; deleting a
// thread interrupts and deletes its session. The alarm reconciles the open turn every minute, and
// so does Anthropic's webhook, so a dropped stream or an evicted cell loses nothing. A call that
// needs Anthropic and cannot reach it answers that the agent cannot be reached, and charges nothing.

import { THREAD_STATUSES } from "@repo/contract/cloud/library/library-wire";
import type { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import { z } from "zod";

import { dropJob, dueJobs, retryJob, scheduleJob } from "../library/cell-jobs";
import type { DueJob } from "../library/cell-jobs";
import type { LandingScope } from "../library/cell-landing";
import { refuse } from "../library/cell-refusal";
import type { CellResult } from "../library/cell-refusal";
import { deleteThread } from "../library/cell-threads";
import type { AgentCell } from "./agent-access";
import { agentIsOn, deleteSession } from "./agent-access";
import { allowanceOf, nextDayAt, turnsLeft } from "./agent-allowance";
import { callFailureFields } from "./managed-agents";
import type { ManagedAgents } from "./managed-agents";
import { confirmCalls, interruptSession } from "./turn-calls";
import {
  createThread,
  dropQueuedFor,
  dropTurn,
  enqueue,
  forgetSession,
  knownThread,
  markInterrupted,
  openTurn,
  queueWaits,
  threadSessionIds,
} from "./turn-rows";
import type { OpenTurn } from "./turn-rows";
import { startOpenTurn, undoStart } from "./turn-start";
import {
  APPROVAL_JOB,
  APPROVAL_LIMIT_MS,
  claimNext,
  claimTurn,
  forgetPayloadSchema,
  landTurn,
  letSessionGo,
  RECONCILE_EVERY_MS,
  restThread,
  sealTurnSet,
  settleApprovals,
  START_LEASE_MS,
  TURN_JOB,
} from "./turn-state";
import { catchUp, confirmEnd, kickTurn, startQueued } from "./turn-stream";

const threadAnswerSchema = z.object({
  status: z.enum(THREAD_STATUSES),
  threadId: z.string(),
});

export type ThreadAnswer = z.infer<typeof threadAnswerSchema>;

const UNAVAILABLE = { ok: false, refusal: { kind: "agent-unavailable" } } as const;
const NOT_FOUND = { ok: false, refusal: { kind: "not-found" } } as const;

// what a call denies a paused call with, in the person's words, which the agent reads
const DENIED_BY_CANCEL = "The person stopped this before it ran.";
const DENIED_UNANSWERED = "Nobody answered in time, so this was not done.";

// a call answered before under `opId` answers the same again
const answeredBefore = <T>(
  cell: AgentCell,
  opId: string | undefined,
  schema: z.ZodType<T>,
): CellResult<T> | null => {
  const prior = cell.library.answered(opId, schema);
  if (!prior.ok) {
    return prior;
  }
  return prior.value === null ? null : { head: null, ok: true, value: prior.value };
};

const statusOf = (scope: LandingScope, threadId: string): ThreadAnswer => ({
  status: knownThread(scope.storage, threadId).status,
  threadId,
});

// ---- sending ----

export interface SendInput {
  readonly opId?: string | undefined;
  readonly text: string;
  readonly threadId?: string | undefined;
  readonly viewContext?: z.infer<typeof agentViewContextSchema> | undefined;
}

// the person's message: a new thread when none is named, the turn claimed when none is open and
// none waits, else a place in the queue; refused once the day's allowance is spent
export const sendToAgent = async (
  cell: AgentCell,
  input: SendInput,
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  const { agents, library } = cell;
  if (agents === null) {
    return UNAVAILABLE;
  }
  const allowance = allowanceOf(cell.env);
  const message = { text: input.text, viewContext: input.viewContext ?? null };
  const claimed = library.landApart({ answer: threadAnswerSchema, opId: input.opId }, (scope) => {
    const { storage } = scope;
    if (!agentIsOn(storage)) {
      refuse({ kind: "agent-unavailable" });
    }
    if (turnsLeft(storage, allowance, scope.now) === 0) {
      refuse({ kind: "agent-budget", resetsAt: nextDayAt(scope.now) });
    }
    const threadId = input.threadId ?? library.ids.thread();
    if (input.threadId === undefined) {
      createThread(scope, threadId, input.text);
    } else {
      knownThread(storage, threadId);
    }
    if (openTurn(storage) !== null || queueWaits(storage)) {
      enqueue(storage, { id: library.ids.queuedSend(), message, queuedAt: scope.now, threadId });
      restThread(scope, threadId);
      return statusOf(scope, threadId);
    }
    claimTurn(scope, { message, threadId });
    return statusOf(scope, threadId);
  });
  if (!claimed.ok || claimed.value.status !== "running") {
    return claimed;
  }
  const started = await startOpenTurn(cell, agents, "first");
  if (started.kind === "failed") {
    await undoStart(cell, started, { opId: input.opId, requeueAs: null });
    return UNAVAILABLE;
  }
  kickTurn(cell);
  return claimed;
};

// ---- answering an approval ----

export interface RespondInput {
  readonly opId?: string | undefined;
  readonly threadId: string;
  readonly eventId: string;
  readonly result: "allow" | "deny";
  readonly denyMessage?: string | undefined;
}

const waitsOn = (turn: OpenTurn | null, threadId: string, eventId: string): turn is OpenTurn =>
  turn !== null &&
  turn.threadId === threadId &&
  turn.phase === "awaiting_approval" &&
  turn.pending.includes(eventId);

// the person's answer to one paused call, sent to the session; once none waits the turn runs on
export const respondToAgent = async (
  cell: AgentCell,
  input: RespondInput,
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  const { agents } = cell;
  if (agents === null) {
    return UNAVAILABLE;
  }
  const read = cell.library.read(openTurn);
  if (!read.ok) {
    return read;
  }
  const turn = read.value;
  if (!waitsOn(turn, input.threadId, input.eventId) || turn.sessionId === null) {
    return NOT_FOUND;
  }
  const sent = await confirmCalls(agents, turn.sessionId, {
    denyMessage: input.denyMessage ?? null,
    eventIds: [input.eventId],
    result: input.result,
    since: turn.askedAt ?? turn.startedAt,
  });
  if (!sent) {
    return UNAVAILABLE;
  }
  const answered = cell.library.landApart(
    { answer: threadAnswerSchema, opId: input.opId },
    (scope) => {
      const now = openTurn(scope.storage);
      if (waitsOn(now, input.threadId, input.eventId)) {
        settleApprovals(scope, now, [input.eventId]);
      }
      return statusOf(scope, input.threadId);
    },
  );
  kickTurn(cell);
  return answered;
};

// ---- stopping ----

// what waits is denied first, since an interrupt alone does nothing to a session paused on an
// approval; false when Anthropic could not be reached
const stopSession = async (agents: ManagedAgents, turn: OpenTurn): Promise<boolean> => {
  if (turn.sessionId === null) {
    return true;
  }
  if (turn.phase === "awaiting_approval") {
    const denied = await confirmCalls(agents, turn.sessionId, {
      denyMessage: DENIED_BY_CANCEL,
      eventIds: turn.pending,
      result: "deny",
      since: turn.askedAt ?? turn.startedAt,
    });
    if (!denied) {
      return false;
    }
  }
  return await interruptSession(agents, turn.sessionId);
};

// the thread's turn stopped and its sends still waiting let go of: a paused call denied, then the
// session interrupted, and the interrupt recorded, since the turn it ends ends on `end_turn` too; a
// turn still starting is interrupted once its message is in
export const cancelTurn = async (
  cell: AgentCell,
  input: { readonly opId?: string | undefined; readonly threadId: string },
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  const read = cell.library.read(openTurn);
  if (!read.ok) {
    return read;
  }
  const turn = read.value?.threadId === input.threadId ? read.value : null;
  const stops = turn !== null && (turn.phase === "running" || turn.phase === "awaiting_approval");
  if (stops && (cell.agents === null || !(await stopSession(cell.agents, turn)))) {
    return UNAVAILABLE;
  }
  const cancelled = cell.library.landApart(
    { answer: threadAnswerSchema, opId: input.opId },
    (scope) => {
      knownThread(scope.storage, input.threadId);
      dropQueuedFor(scope.storage, input.threadId);
      const now = openTurn(scope.storage);
      if (now?.threadId === input.threadId) {
        markInterrupted(scope.storage);
        if (now.phase === "awaiting_approval") {
          settleApprovals(scope, now, now.pending);
        }
      } else {
        restThread(scope, input.threadId);
      }
      return statusOf(scope, input.threadId);
    },
  );
  kickTurn(cell);
  return cancelled;
};

// ---- deleting a thread ----

const deletedSchema = z.object({ deleted: z.literal(true) });

// a session the cell let go of, deleted at Anthropic once it settles; the job asks again if not
const forgetNow = async (cell: AgentCell, sessionId: string): Promise<boolean> => {
  if (cell.agents === null) {
    return false;
  }
  try {
    await deleteSession(cell.agents, sessionId);
  } catch (error) {
    console.warn({ event: "agent-session-delete-failed", ...callFailureFields(error) });
    return false;
  }
  await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
    forgetSession(scope.storage, sessionId);
    dropJob(scope.storage, `agent-forget:${sessionId}`);
    return true as const;
  });
  return true;
};

const forgetInBackground = async (cell: AgentCell, sessionId: string): Promise<void> => {
  await forgetNow(cell, sessionId);
};

// the thread, its events and its sends waiting, gone from every device; its open turn sealed with
// what it already wrote, and every session it ran in interrupted and deleted at Anthropic
export const deleteAgentThread = async (
  cell: AgentCell,
  input: { readonly opId?: string | undefined; readonly threadId: string },
): Promise<CellResult<z.infer<typeof deletedSchema>>> => {
  const prior = answeredBefore(cell, input.opId, deletedSchema);
  if (prior !== null) {
    return prior;
  }
  const forget: string[] = [];
  let next: string | null = null;
  const deleted = cell.library.landApart({ answer: deletedSchema, opId: input.opId }, (scope) => {
    const { storage } = scope;
    knownThread(storage, input.threadId);
    const turn = openTurn(storage);
    if (turn?.threadId === input.threadId) {
      sealTurnSet(storage, turn, scope.now);
      dropTurn(storage);
      dropJob(storage, TURN_JOB.id);
      dropJob(storage, APPROVAL_JOB.id);
    }
    dropQueuedFor(storage, input.threadId);
    forget.length = 0;
    for (const sessionId of threadSessionIds(storage, input.threadId)) {
      letSessionGo(scope, input.threadId, sessionId);
      forget.push(sessionId);
    }
    deleteThread(scope, input.threadId);
    next = turn?.threadId === input.threadId ? claimNext(scope) : null;
    return { deleted: true as const };
  });
  if (!deleted.ok) {
    return deleted;
  }
  for (const sessionId of forget) {
    cell.waitUntil(forgetInBackground(cell, sessionId));
  }
  if (next !== null && cell.agents !== null && (await startQueued(cell, cell.agents))) {
    kickTurn(cell);
  }
  return deleted;
};

// ---- what is left of the day ----

export const agentStatus = (cell: AgentCell) => {
  const allowance = allowanceOf(cell.env);
  const now = cell.now();
  return cell.library.read((sql) => ({
    enabled: agentIsOn(sql),
    resetsAt: nextDayAt(now),
    turnsLeft: turnsLeft(sql, allowance, now),
  }));
};

// ---- the reconcile ----

const reconcileOpen = async (
  cell: AgentCell,
  agents: ManagedAgents,
  turn: OpenTurn,
): Promise<void> => {
  if (turn.phase === "starting") {
    if (cell.now() - turn.startedAt < START_LEASE_MS) {
      return;
    }
    const started = await startOpenTurn(cell, agents, "again");
    if (started.kind === "failed") {
      await undoStart(cell, started, { opId: undefined, requeueAs: cell.library.ids.queuedSend() });
    } else {
      kickTurn(cell);
    }
    return;
  }
  if (turn.sessionId === null || (turn.phase === "running" && cell.driver.driving)) {
    return;
  }
  const state = await catchUp(cell, agents, {
    sessionId: turn.sessionId,
    threadId: turn.threadId,
  });
  if (state === "ending" && (await confirmEnd(cell, agents, turn))) {
    kickTurn(cell);
  } else if (state === "running") {
    kickTurn(cell);
  }
};

// the open turn brought up to date with its session: a start cut short started again, the events
// the stream missed kept, an ending turn sealed once its session rests, and a running one read
// again when no reader holds it; asked by the alarm every minute while a turn is open, and by
// Anthropic's webhook as a session idles or ends
export const reconcileTurn = async (cell: AgentCell): Promise<void> => {
  const read = cell.library.read(openTurn);
  const turn = read.ok ? read.value : null;
  const { agents } = cell;
  if (turn !== null && agents !== null) {
    await reconcileOpen(cell, agents, turn);
  }
  await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
    if (openTurn(scope.storage) === null) {
      dropJob(scope.storage, TURN_JOB.id);
    } else {
      scheduleJob(scope.storage, TURN_JOB, scope.now + RECONCILE_EVERY_MS);
    }
    return true as const;
  });
};

// ---- the alarm's ----

// an approval nobody answered in its ten minutes, denied, and the turn run on
const expireApproval = async (cell: AgentCell, job: DueJob): Promise<void> => {
  const read = cell.library.read(openTurn);
  const turn = read.ok ? read.value : null;
  if (turn?.phase !== "awaiting_approval" || turn.sessionId === null || cell.agents === null) {
    await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
      const now = openTurn(scope.storage);
      if (now?.phase === "awaiting_approval" && cell.agents === null) {
        retryJob(scope.storage, job, scope.now);
      } else {
        dropJob(scope.storage, APPROVAL_JOB.id);
      }
      return true as const;
    });
    return;
  }
  const due = (turn.askedAt ?? turn.startedAt) + APPROVAL_LIMIT_MS;
  if (due > cell.now()) {
    await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
      scheduleJob(scope.storage, APPROVAL_JOB, due);
      return true as const;
    });
    return;
  }
  const denied = await confirmCalls(cell.agents, turn.sessionId, {
    denyMessage: DENIED_UNANSWERED,
    eventIds: turn.pending,
    result: "deny",
    since: turn.askedAt ?? turn.startedAt,
  });
  await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
    const now = openTurn(scope.storage);
    if (!denied) {
      retryJob(scope.storage, job, scope.now);
    } else if (now?.phase === "awaiting_approval" && now.threadId === turn.threadId) {
      settleApprovals(scope, now, turn.pending);
    }
    return true as const;
  });
  kickTurn(cell);
};

// the send that waited longest started, once no turn is open
const startNextQueued = async (cell: AgentCell): Promise<void> => {
  const claimed = await landTurn(
    cell,
    { answer: z.string().nullable(), opId: undefined },
    (scope) => claimNext(scope),
  );
  if (
    claimed.ok &&
    claimed.value !== null &&
    cell.agents !== null &&
    (await startQueued(cell, cell.agents))
  ) {
    kickTurn(cell);
  }
};

const TURN_JOBS = ["agent-turn", "agent-approval", "agent-queue", "agent-forget"] as const;

const runTurnJob = async (
  cell: AgentCell,
  job: DueJob<(typeof TURN_JOBS)[number]>,
): Promise<void> => {
  switch (job.kind) {
    case "agent-turn": {
      await reconcileTurn(cell);
      break;
    }
    case "agent-approval": {
      await expireApproval(cell, job);
      break;
    }
    case "agent-queue": {
      await startNextQueued(cell);
      break;
    }
    case "agent-forget": {
      const { sessionId } = forgetPayloadSchema.parse(JSON.parse(job.payload));
      if (!(await forgetNow(cell, sessionId))) {
        await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
          retryJob(scope.storage, job, scope.now);
          return true as const;
        });
      }
      break;
    }
    // no default
  }
};

// the turn's jobs due, each leaving its own row as it should be; one that throws is put off longer
export const runTurnJobs = async (cell: AgentCell): Promise<void> => {
  const due = cell.library.read((sql) => dueJobs(sql, cell.now(), TURN_JOBS));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    try {
      await runTurnJob(cell, job);
    } catch (error) {
      console.error({
        event: "agent-turn-job-failed",
        kind: job.kind,
        ...callFailureFields(error),
      });
      await landTurn(cell, { answer: z.literal(true), opId: undefined }, (scope) => {
        retryJob(scope.storage, job, scope.now);
        return true as const;
      });
    }
  }
};
