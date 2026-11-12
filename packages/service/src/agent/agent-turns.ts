// The built-in agent's turns, as the account's cell keeps them: `library.agent.*` as the person
// asks, and the three calls each conversation's object makes back (`./thread-wire`). A send is let
// in, in one transaction, when the agent is on and Claude reachable, and the day's turns allow it: a new thread gets its row, and the turn opens, or waits behind its thread's open turn
// or while the account runs as many as it may at once. An open turn is handed to its thread's
// object (`./agent-thread`) after the commit, again every 30 seconds until it lands; every tool
// call runs here, under the turn, against the library's own procedures; and what the turn did
// lands here as pushes, each once by its sequence, as the thread's stored events. The push that
// ends a turn seals it: one
// change set, the turn given back when Claude could not be reached, the links it saved read, and
// the next waiting send let in. A watch job asks after a turn whose object it has not heard from
// in five minutes.

import { agentEventSchema } from "@repo/contract/library/agent-events";
import type { AgentEvent, TurnEndReason } from "@repo/contract/library/agent-events";
import type { LibrarySocketFrame } from "@repo/contract/library/library-socket";
import { THREAD_STATUSES } from "@repo/contract/library/library-wire";
import { ORPCError } from "@orpc/server";
import type { agentViewContextSchema } from "@repo/contract/library/library-wire";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { changeSets, threadEvents } from "@repo/db/cell/schema";
import type { CellActor } from "../library/cell-actor";
import { dropJob, deferJob, dueJobs, retryJob, scheduleJob } from "../library/cell-jobs";
import type { DueJob, JobRequest } from "../library/cell-jobs";
import { releaseHeldFills } from "../library/cell-fills";
import type { LandingScope } from "../library/cell-landing";
import type { CellDb } from "../library/cell-db";
import type { CellStorage } from "../library/cell-storage";
import { refuse } from "../library/cell-refusal";
import type { CellResult } from "../library/cell-refusal";
import { deleteThread } from "../library/cell-threads";
import { sealChangeSet } from "../library/change-sets";
import type { LibraryEngine } from "../library/library-engine";
import { filingRules } from "../library/library-rules";
import { jsonTextSchema } from "../library/sql-value";
import { errorFields } from "../log";
import { pushedEventId, storeEvent, turnEventId } from "./agent-events";
import { allowanceOf, bookTurn, dayOf, nextDayAt, turnsLeft } from "./agent-allowance";
import type { Allowance } from "./agent-allowance";
import { agentConfigured } from "./anthropic-client";
import { turnUserMessage } from "./turn-message";
import {
  agentIsOn,
  createThread,
  dequeueNext,
  dropQueuedFor,
  dropTurn,
  enqueue,
  everyThreadId,
  forgetPushes,
  heardFrom,
  insertTurn,
  knownThread,
  lastPush,
  markCancel,
  moveWaiting,
  nextTurnNumber,
  openTurnCount,
  openTurnOf,
  recordPush,
  restatus,
  storedStatus,
  turnActor,
} from "./turn-rows";
import type { OpenTurn, TurnMessage } from "./turn-rows";
import { previewRequestSchema, pushRequestSchema, toolRequestSchema } from "./thread-wire";
import type {
  CellAnswer,
  PreviewRequest,
  PushRequest,
  ThreadInspection,
  ToolAnswer,
  ToolRequest,
} from "./thread-wire";
import { threadStub } from "./thread-stub";

// the cell as the agent's turns need it (`../library/library-do`)
export interface AgentCell {
  readonly accountId: string;
  readonly env: Env;
  readonly exports: Cloudflare.Exports;
  readonly library: LibraryEngine;
  readonly now: () => number;
  readonly tell: (frame: LibrarySocketFrame) => void;
  // what follows a committed write: the sockets told the head, the readings sent, the alarm set
  readonly settle: <T>(result: CellResult<T>) => Promise<CellResult<T>>;
  // one tool call of an open turn, run through the library's procedures as that turn's
  readonly runTool: (request: ToolRequest) => Promise<ToolAnswer>;
}

const threadAnswerSchema = z.object({ status: z.enum(THREAD_STATUSES), threadId: z.string() });

export type ThreadAnswer = z.infer<typeof threadAnswerSchema>;

const UNAVAILABLE = { ok: false, refusal: { kind: "agent-unavailable" } } as const;
const NOT_FOUND = { ok: false, refusal: { kind: "not-found" } } as const;

// a turn's object is asked after once it has been quiet this long
const WATCH_EVERY_MS = 5 * 60_000;
// a delivery that did not land goes again this long after
const DELIVER_AGAIN_MS = 30_000;

const deliverJob = (threadId: string): JobRequest<"agent-deliver"> => ({
  id: `agent-deliver:${threadId}`,
  kind: "agent-deliver",
  payload: { threadId },
});

const watchJob = (threadId: string): JobRequest<"agent-watch"> => ({
  id: `agent-watch:${threadId}`,
  kind: "agent-watch",
  payload: { threadId },
});

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
  return prior.value === null ? null : { moved: null, ok: true, value: prior.value };
};

const statusOf = (db: CellDb, threadId: string): ThreadAnswer => ({
  status: knownThread(db, threadId),
  threadId,
});

// ---- opening a turn ----

// the turn, the send's: counted against the day as it begins, the person's message its first
// event, its thread running, and its delivery and watch asked for
const openTurn = (
  scope: LandingScope,
  send: { readonly threadId: string; readonly message: TurnMessage },
): void => {
  const { storage, now } = scope;
  const turn = nextTurnNumber(storage.db, send.threadId);
  insertTurn(storage.db, { at: now, message: send.message, threadId: send.threadId, turn });
  bookTurn(storage.db, dayOf(now), 1);
  const event: AgentEvent = { text: send.message.text, type: "user.message" };
  if (send.message.viewContext !== null) {
    event.viewContext = send.message.viewContext;
  }
  storeEvent(scope, send.threadId, turnEventId(send.threadId, turn), event);
  restatus(scope, send.threadId);
  scheduleJob(storage.db, deliverJob(send.threadId), now);
  scheduleJob(storage.db, watchJob(send.threadId), now + WATCH_EVERY_MS);
};

// the sends let in now, as many as the account may run at once: `first`'s before any other, then
// the longest waiting
const openWaiting = (scope: LandingScope, allowance: Allowance, first: string | null): void => {
  if (!agentIsOn(scope.storage.db)) {
    return;
  }
  while (openTurnCount(scope.storage.db) < allowance.concurrentTurns) {
    const next = dequeueNext(scope.storage.db, first);
    if (next === null) {
      return;
    }
    openTurn(scope, next);
  }
};

// the change set a turn's writes opened, sealed: one undoable set a turn
const sealTurnSet = (
  storage: CellStorage,
  turn: Pick<OpenTurn, "threadId" | "turn">,
  now: number,
): string[] => {
  const sets = storage.db
    .select({ id: changeSets.id, sealedAt: changeSets.sealedAt })
    .from(changeSets)
    .where(
      and(
        eq(changeSets.actor, "agent"),
        eq(changeSets.threadId, turn.threadId),
        eq(changeSets.turn, turn.turn),
      ),
    )
    .all();
  for (const set of sets) {
    if (set.sealedAt === null) {
      sealChangeSet(storage, set.id, now);
    }
  }
  return sets.map(({ id }) => id);
};

// a turn over: its change set sealed, the turn given back when it ended because Claude could not be
// reached, the links it saved let go to be read, and its row gone. A turn the person stopped still
// counts, so a send stopped at once is no free call
const closeTurn = (scope: LandingScope, turn: OpenTurn, reason: TurnEndReason): void => {
  const { storage, now } = scope;
  const sets = sealTurnSet(storage, turn, now);
  if (reason === "unavailable") {
    bookTurn(storage.db, dayOf(turn.startedAt), -1);
  }
  releaseHeldFills(storage.db, sets, now);
  dropTurn(storage.db, turn.threadId);
  dropJob(storage.db, deliverJob(turn.threadId).id);
  dropJob(storage.db, watchJob(turn.threadId).id);
};

// ---- handing a turn to its thread ----

// a write of the agent's bookkeeping rows alone, its jobs: nothing to answer, settled as any other
const landRows = async (cell: AgentCell, work: (scope: LandingScope) => void): Promise<void> => {
  await cell.settle(
    cell.library.landApart({ answer: z.null(), opId: undefined }, (scope) => {
      work(scope);
      return null;
    }),
  );
};

// the open turn handed to its thread's object with the last push landed of it, and stopped there
// when the person stopped it; the job stays for the alarm until both landed
const deliverTurn = async (cell: AgentCell, threadId: string): Promise<void> => {
  const read = cell.library.read((storage) => {
    const turn = openTurnOf(storage.db, threadId);
    return turn === null
      ? null
      : { pushedThrough: lastPush(storage.db, threadId), rules: filingRules(storage.db), turn };
  });
  if (!read.ok) {
    return;
  }
  if (read.value === null) {
    await landRows(cell, (scope) => {
      dropJob(scope.storage.db, deliverJob(threadId).id);
    });
    return;
  }
  const { pushedThrough, rules, turn } = read.value;
  const stub = threadStub(cell.exports, cell.accountId, threadId);
  try {
    await stub.send({
      content: turnUserMessage(turn.message),
      opId: `${threadId}:${String(turn.turn)}`,
      pushedThrough,
      rules,
      threadId,
      turn: turn.turn,
    });
    if (turn.cancel) {
      await stub.cancel({ turn: turn.turn });
    }
  } catch (error) {
    console.warn({ event: "agent-deliver-failed", threadId, ...errorFields(error) });
    await landRows(cell, (scope) => {
      deferJob(scope.storage.db, deliverJob(threadId).id, scope.now + DELIVER_AGAIN_MS);
    });
    return;
  }
  await landRows(cell, (scope) => {
    // a stop asked for meanwhile is delivered by the job it asked for
    if (openTurnOf(scope.storage.db, threadId)?.cancel !== true || turn.cancel) {
      dropJob(scope.storage.db, deliverJob(threadId).id);
    }
  });
};

// ---- sending ----

export interface SendInput {
  readonly opId?: string | undefined;
  readonly text: string;
  readonly threadId?: string | undefined;
  readonly viewContext?: z.infer<typeof agentViewContextSchema> | undefined;
}

// the person's message: a new thread when none is named, the turn opened when the thread has
// none open and the account room for one, else a place in the queue; refused once the day's
// allowance is spent, and with no Claude to call or the agent off, counted against nothing
export const sendToAgent = async (
  cell: AgentCell,
  input: SendInput,
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  if (!agentConfigured(cell.env)) {
    return UNAVAILABLE;
  }
  const allowance = allowanceOf(cell.env);
  const message = { text: input.text, viewContext: input.viewContext ?? null };
  const landed = cell.library.landApart(
    { answer: threadAnswerSchema, opId: input.opId },
    (scope): ThreadAnswer => {
      const { storage } = scope;
      if (!agentIsOn(storage.db)) {
        refuse({ kind: "agent-unavailable" });
      }
      if (turnsLeft(storage.db, allowance, scope.now) === 0) {
        refuse({ kind: "agent-budget", resetsAt: nextDayAt(scope.now) });
      }
      const threadId = input.threadId ?? cell.library.ids.thread();
      if (input.threadId === undefined) {
        createThread(scope, threadId, input.text);
      } else {
        knownThread(storage.db, threadId);
      }
      const ownOpen = openTurnOf(storage.db, threadId) !== null;
      if (ownOpen || openTurnCount(storage.db) >= allowance.concurrentTurns) {
        enqueue(storage.db, {
          id: cell.library.ids.queuedSend(),
          message,
          queuedAt: scope.now,
          threadId,
        });
        restatus(scope, threadId);
        return { status: "queued", threadId };
      }
      openTurn(scope, { message, threadId });
      return { status: "running", threadId };
    },
  );
  if (landed.ok && landed.value.status === "running") {
    await deliverTurn(cell, landed.value.threadId);
  }
  return landed;
};

// ---- answering an approval ----

export interface RespondInput {
  readonly opId?: string | undefined;
  readonly threadId: string;
  readonly eventId: string;
  readonly result: "allow" | "deny";
  readonly denyMessage?: string | undefined;
}

const eventText = jsonTextSchema.pipe(agentEventSchema);

// the call an `approval.asked` event asked about, or null for an event that asked nothing
const askedCall = (db: CellDb, threadId: string, eventId: string): string | null => {
  knownThread(db, threadId);
  const row = db
    .select({ json: threadEvents.json })
    .from(threadEvents)
    .where(
      and(
        eq(threadEvents.eventId, eventId),
        eq(threadEvents.threadId, threadId),
        eq(threadEvents.type, "approval.asked"),
      ),
    )
    .get();
  const event = row === undefined ? null : eventText.safeParse(row.json);
  return event?.success === true && event.data.type === "approval.asked"
    ? event.data.toolUseId
    : null;
};

// the person's answer to one call that waits on them, handed to the thread, which decides it once
export const respondToAgent = async (
  cell: AgentCell,
  input: RespondInput,
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  const read = cell.library.read(({ db }) => askedCall(db, input.threadId, input.eventId));
  if (!read.ok) {
    return read;
  }
  if (read.value === null) {
    return NOT_FOUND;
  }
  try {
    await threadStub(cell.exports, cell.accountId, input.threadId).respond({
      approved: input.result === "allow",
      reason: input.denyMessage ?? null,
      toolUseId: read.value,
    });
  } catch (error) {
    console.warn({ event: "agent-respond-failed", ...errorFields(error) });
    return UNAVAILABLE;
  }
  return cell.library.landApart({ answer: threadAnswerSchema, opId: input.opId }, (scope) =>
    statusOf(scope.storage.db, input.threadId),
  );
};

// ---- stopping ----

// the thread's turn stopped, durably here and then in its object, and its waiting sends let go
export const cancelTurn = async (
  cell: AgentCell,
  input: { readonly opId?: string | undefined; readonly threadId: string },
): Promise<CellResult<ThreadAnswer>> => {
  const prior = answeredBefore(cell, input.opId, threadAnswerSchema);
  if (prior !== null) {
    return prior;
  }
  const landed = cell.library.landApart(
    { answer: threadAnswerSchema, opId: input.opId },
    (scope) => {
      const { storage } = scope;
      knownThread(storage.db, input.threadId);
      dropQueuedFor(storage.db, input.threadId);
      if (openTurnOf(storage.db, input.threadId) === null) {
        restatus(scope, input.threadId);
      } else {
        markCancel(storage.db, input.threadId);
        scheduleJob(storage.db, deliverJob(input.threadId), scope.now);
      }
      return statusOf(storage.db, input.threadId);
    },
  );
  if (landed.ok) {
    await deliverTurn(cell, input.threadId);
  }
  return landed;
};

// every open turn stopped and every waiting send let go, as turning the agent off does
export const stopEveryTurn = (scope: LandingScope): void => {
  const { storage } = scope;
  for (const threadId of everyThreadId(storage.db)) {
    dropQueuedFor(storage.db, threadId);
    if (openTurnOf(storage.db, threadId) === null) {
      restatus(scope, threadId);
    } else {
      markCancel(storage.db, threadId);
      scheduleJob(storage.db, deliverJob(threadId), scope.now);
    }
  }
};

// ---- deleting a thread ----

const deletedSchema = z.object({ deleted: z.literal(true) });

// the thread gone: its object purged first, everything it keeps with it, then its rows and events
// from every device, its open turn closed with what it wrote, and the next waiting send let in
export const deleteAgentThread = async (
  cell: AgentCell,
  input: { readonly opId?: string | undefined; readonly threadId: string },
): Promise<CellResult<z.infer<typeof deletedSchema>>> => {
  const prior = answeredBefore(cell, input.opId, deletedSchema);
  if (prior !== null) {
    return prior;
  }
  const read = cell.library.read(({ db }) => knownThread(db, input.threadId));
  if (!read.ok) {
    return read;
  }
  try {
    await threadStub(cell.exports, cell.accountId, input.threadId).purge();
  } catch (error) {
    console.warn({ event: "agent-purge-failed", ...errorFields(error) });
    return UNAVAILABLE;
  }
  const allowance = allowanceOf(cell.env);
  return cell.library.landApart({ answer: deletedSchema, opId: input.opId }, (scope) => {
    const { storage } = scope;
    knownThread(storage.db, input.threadId);
    const open = openTurnOf(storage.db, input.threadId);
    if (open !== null) {
      closeTurn(scope, open, "cancelled");
    }
    dropQueuedFor(storage.db, input.threadId);
    forgetPushes(storage.db, input.threadId);
    deleteThread(scope, input.threadId);
    openWaiting(scope, allowance, null);
    return { deleted: true as const };
  });
};

// ---- what is left of the day ----

export const agentStatus = (cell: AgentCell) => {
  const allowance = allowanceOf(cell.env);
  const now = cell.now();
  return cell.library.read(({ db }) => ({
    enabled: agentIsOn(db),
    resetsAt: nextDayAt(now),
    turnsLeft: turnsLeft(db, allowance, now),
  }));
};

// whom a turn's tool calls write as: that turn, read again as each write lands, so a call that
// lands once its turn sealed is refused
export const turnActorOf =
  (library: LibraryEngine, named: { readonly threadId: string; readonly turn: number }) =>
  (): CellActor => {
    const open = library.read(({ db }) => openTurnOf(db, named.threadId));
    if (!open.ok || open.value?.turn !== named.turn) {
      throw new ORPCError("FORBIDDEN", { message: "This turn has ended." });
    }
    return turnActor(open.value);
  };

// ---- what a thread's object asks ----

const gone = <T>(): CellAnswer<T> => ({ ok: false, refusal: "unknown-thread" });

// the thread and its open turn as a call names them: one the cell holds no thread of, one whose
// turn is not open, or the turn
type TurnNamed =
  | { readonly kind: "open"; readonly turn: OpenTurn }
  | { readonly kind: "unknown-thread" }
  | { readonly kind: "turn-closed" };

const turnNamed = (
  db: CellDb,
  named: { readonly threadId: string; readonly turn: number },
): TurnNamed => {
  if (storedStatus(db, named.threadId) === null) {
    return { kind: "unknown-thread" };
  }
  const open = openTurnOf(db, named.threadId);
  return open?.turn === named.turn ? { kind: "open", turn: open } : { kind: "turn-closed" };
};

// one tool call of an open turn, run as that turn's; its refusal or failure is the agent's to read
export const runTurnTool = async (
  cell: AgentCell,
  request: ToolRequest,
): Promise<CellAnswer<ToolAnswer>> => {
  const parsed = toolRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: true, value: { content: "That call could not be read.", isError: true } };
  }
  const call = parsed.data;
  const checked = cell.library.landApart(
    { answer: z.enum(["open", "unknown-thread", "turn-closed"]), opId: undefined },
    (scope) => {
      const named = turnNamed(scope.storage.db, call);
      if (named.kind !== "open") {
        return named.kind;
      }
      heardFrom(scope.storage.db, call.threadId, scope.now);
      return "open" as const;
    },
  );
  if (!checked.ok) {
    return gone();
  }
  if (checked.value !== "open") {
    return { ok: false, refusal: checked.value };
  }
  return { ok: true, value: await cell.runTool(call) };
};

const pushOutcomeSchema = z.object({ kind: z.enum(["landed", "unknown-thread", "turn-closed"]) });

// one push of a thread's object, applied once by its sequence in one transaction: its events
// stored, the thread's status moved, and the turn sealed by the push that ends it
export const landPush = async (
  cell: AgentCell,
  request: PushRequest,
): Promise<CellAnswer<null>> => {
  const parsed = pushRequestSchema.safeParse(request);
  if (!parsed.success) {
    // a push this build cannot read lands nothing, and is let go rather than sent forever
    console.error({ event: "agent-push-malformed", issues: parsed.error.issues.length });
    return { ok: true, value: null };
  }
  const push = parsed.data;
  const allowance = allowanceOf(cell.env);
  const landed = cell.library.landApart(
    { answer: pushOutcomeSchema, opId: undefined },
    (scope): z.infer<typeof pushOutcomeSchema> => {
      const { storage } = scope;
      if (storedStatus(storage.db, push.threadId) === null) {
        return { kind: "unknown-thread" };
      }
      if (push.seq <= lastPush(storage.db, push.threadId)) {
        return { kind: "landed" };
      }
      recordPush(storage.db, push.threadId, push.seq);
      const named = turnNamed(storage.db, push);
      if (named.kind !== "open") {
        return { kind: "turn-closed" };
      }
      heardFrom(storage.db, push.threadId, scope.now);
      let ended: TurnEndReason | null = null;
      for (const [index, event] of push.events.entries()) {
        storeEvent(scope, push.threadId, pushedEventId(push.threadId, push.seq, index), event);
        if (event.type === "approval.asked" || event.type === "approval.answered") {
          moveWaiting(storage.db, push.threadId, event.type === "approval.asked" ? 1 : -1);
          restatus(scope, push.threadId);
        }
        if (event.type === "turn.ended") {
          ended = event.reason;
        }
      }
      if (ended !== null) {
        closeTurn(scope, named.turn, ended);
        restatus(scope, push.threadId);
        openWaiting(scope, allowance, push.threadId);
      }
      return { kind: "landed" };
    },
  );
  if (!landed.ok) {
    return gone();
  }
  await cell.settle(landed);
  const { kind } = landed.value;
  return kind === "landed" ? { ok: true, value: null } : { ok: false, refusal: kind };
};

// the reply as it is written, on the account's sockets alone: never stored, never read again, and
// let go by each device once the moved frame of a later commit names its thread
export const showPreview = (cell: AgentCell, request: PreviewRequest): CellAnswer<null> => {
  const parsed = previewRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: true, value: null };
  }
  const preview = parsed.data;
  const read = cell.library.read(({ db }) => turnNamed(db, preview));
  if (!read.ok) {
    return gone();
  }
  if (read.value.kind !== "open") {
    return { ok: false, refusal: read.value.kind };
  }
  cell.tell({ text: preview.text, threadId: preview.threadId, type: "preview" });
  return { ok: true, value: null };
};

// ---- the alarm's ----

// a turn whose object the cell has not heard from in five minutes, asked after: the ask starts the
// object, which wakes any work an instance left, and an object that holds no open turn and nothing
// unsent, one that started over on another version of its tables, is handed the turn again
const watchTurn = async (cell: AgentCell, threadId: string): Promise<void> => {
  const read = cell.library.read(({ db }) => openTurnOf(db, threadId));
  const turn = read.ok ? read.value : null;
  if (turn !== null && cell.now() - turn.heardAt >= WATCH_EVERY_MS) {
    let inspection: ThreadInspection | null = null;
    try {
      inspection = await threadStub(cell.exports, cell.accountId, threadId).inspect();
    } catch (error) {
      console.warn({ event: "agent-watch-failed", threadId, ...errorFields(error) });
    }
    if (inspection?.turn === null && inspection.outbox === 0) {
      await deliverTurn(cell, threadId);
    }
  }
  await landRows(cell, (scope) => {
    if (openTurnOf(scope.storage.db, threadId) === null) {
      dropJob(scope.storage.db, watchJob(threadId).id);
    } else {
      scheduleJob(scope.storage.db, watchJob(threadId), scope.now + WATCH_EVERY_MS);
    }
  });
};

const AGENT_JOBS = ["agent-deliver", "agent-watch"] as const;

const runAgentJob = async (
  cell: AgentCell,
  job: DueJob<(typeof AGENT_JOBS)[number]>,
): Promise<void> => {
  const { threadId } = job.payload;
  await (job.kind === "agent-deliver" ? deliverTurn(cell, threadId) : watchTurn(cell, threadId));
};

// the agent's jobs due, each leaving its own row as it should be; one that throws is put off
export const runAgentJobs = async (cell: AgentCell): Promise<void> => {
  const due = cell.library.read((storage) => dueJobs(storage.db, cell.now(), AGENT_JOBS));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    try {
      await runAgentJob(cell, job);
    } catch (error) {
      console.error({ event: "agent-job-failed", kind: job.kind, ...errorFields(error) });
      await landRows(cell, (scope) => {
        retryJob(scope.storage.db, job, scope.now);
      });
    }
  }
};

// ---- the account's deletion ----

// every conversation's object the account's threads name, purged, read past the tombstone from
// the cell's own rows: what they keep goes before the cell's own rows do
export const purgeThreadObjects = async (
  db: CellDb,
  exports: Cloudflare.Exports,
  accountId: string,
): Promise<void> => {
  await Promise.all(
    everyThreadId(db).map(async (threadId) => {
      await threadStub(exports, accountId, threadId).purge();
    }),
  );
};
