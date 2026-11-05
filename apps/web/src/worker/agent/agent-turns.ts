// The built-in agent's turns, as the account's cell keeps them: `library.agent.*` as the person
// asks, and the four calls each conversation's object makes back (`./thread-wire`). A send is let
// in, in one transaction, when the agent is on and Claude reachable, and the day's turns and cost
// allow it: a new thread gets its row, and the turn opens, or waits behind its thread's open turn
// or while the account runs as many as it may at once. An open turn is handed to its thread's
// object (`./agent-thread`) after the commit, again every 30 seconds until it lands; every model
// call the object makes is reserved here first and settled at its exact usage after; every tool
// call runs here, under the turn, against the library's own procedures; and what the turn did
// lands here as pushes, each once by its sequence, as the account's synced events. The push that
// ends a turn seals it: one change set, its open reservations booked, a turn that cost nothing
// given back, the links it saved read, and the next waiting send let in. A watch job asks after a
// turn whose object it has not heard from in five minutes.

import { agentEventSchema } from "@repo/contract/cloud/library/agent-events";
import type { AgentEvent } from "@repo/contract/cloud/library/agent-events";
import type { LibrarySocketFrame } from "@repo/contract/cloud/library/library-socket";
import { THREAD_STATUSES, threadEventRowSchema } from "@repo/contract/cloud/library/library-wire";
import { ORPCError } from "@orpc/server";
import type { agentViewContextSchema } from "@repo/contract/cloud/library/library-wire";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { CellActor } from "../library/cell-actor";
import { dropJob, deferJob, dueJobs, retryJob, scheduleJob } from "../library/cell-jobs";
import type { DueJob } from "../library/cell-jobs";
import { releaseHeldFills } from "../library/cell-fills";
import type { LandingScope } from "../library/cell-landing";
import { refuse } from "../library/cell-refusal";
import type { CellResult } from "../library/cell-refusal";
import { deleteThread } from "../library/cell-threads";
import { sealChangeSet } from "../library/change-sets";
import type { LibraryEngine } from "../library/library-engine";
import { errorFields } from "../log";
import { pushedEventId, storeEvent, turnEventId } from "./agent-events";
import type { ThreadEventRow } from "./agent-events";
import {
  allowanceOf,
  bookTurn,
  dayOf,
  heldReservation,
  limitsOf,
  nextDayAt,
  pricesFor,
  pricesOf,
  priceUsage,
  recordReservation,
  reservationOf,
  resendReservationOf,
  settleCall,
  settleTurnCalls,
  turnsLeft,
  usageReportSchema,
} from "./agent-allowance";
import type { Allowance, PriceTable } from "./agent-allowance";
import { agentConfigured } from "./anthropic-client";
import { AGENT_MODEL } from "./library-agent";
import { filingRules, turnUserMessage } from "./turn-message";
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
  queuedFor,
  recordPush,
  setThreadStatus,
  threadState,
  turnActor,
} from "./turn-rows";
import type { OpenTurn, TurnMessage } from "./turn-rows";
import {
  previewRequestSchema,
  pushRequestSchema,
  reserveRequestSchema,
  toolRequestSchema,
} from "./thread-wire";
import type {
  CellAnswer,
  PreviewRequest,
  PushEntry,
  PushRequest,
  Reservation,
  ReserveRequest,
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

const jobPayloadSchema = z.object({ threadId: z.string().min(1) });

const deliverJob = (threadId: string) =>
  ({
    id: `agent-deliver:${threadId}`,
    kind: "agent-deliver",
    payload: JSON.stringify({ threadId }),
  }) as const;

const watchJob = (threadId: string) =>
  ({
    id: `agent-watch:${threadId}`,
    kind: "agent-watch",
    payload: JSON.stringify({ threadId }),
  }) as const;

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

const statusOf = (sql: SqlStatements, threadId: string): ThreadAnswer => ({
  status: knownThread(sql, threadId).status,
  threadId,
});

// each stored event told to the account's sockets, once its transaction committed
const frameEvents = (cell: AgentCell, rows: readonly ThreadEventRow[]): void => {
  for (const row of rows) {
    cell.tell({ event: row.event, preview: false, threadId: row.threadId, type: "thread" });
  }
};

// where a thread rests between turns: behind a send of its own still waiting, else idle
const restThread = (scope: LandingScope, threadId: string): void => {
  setThreadStatus(scope, threadId, queuedFor(scope.storage, threadId) > 0 ? "queued" : "idle");
};

// ---- opening a turn ----

// the turn, the send's: counted against the day as it begins, the person's message its first
// event, its thread running, and its delivery and watch asked for
const openTurn = (
  scope: LandingScope,
  send: { readonly threadId: string; readonly message: TurnMessage },
): ThreadEventRow | null => {
  const { storage, now } = scope;
  const turn = nextTurnNumber(storage, send.threadId);
  insertTurn(storage, { at: now, message: send.message, threadId: send.threadId, turn });
  bookTurn(storage, dayOf(now), 1);
  const event: AgentEvent = { text: send.message.text, type: "user.message" };
  if (send.message.viewContext !== null) {
    event.viewContext = send.message.viewContext;
  }
  const row = storeEvent(scope, send.threadId, turnEventId(send.threadId, turn), event);
  setThreadStatus(scope, send.threadId, "running");
  scheduleJob(storage, deliverJob(send.threadId), now);
  scheduleJob(storage, watchJob(send.threadId), now + WATCH_EVERY_MS);
  return row;
};

// the sends let in now, as many as the account may run at once: `first`'s before any other, then
// the longest waiting
const openWaiting = (
  scope: LandingScope,
  allowance: Allowance,
  first: string | null,
): ThreadEventRow[] => {
  const rows: ThreadEventRow[] = [];
  if (!agentIsOn(scope.storage)) {
    return rows;
  }
  while (openTurnCount(scope.storage) < allowance.concurrentTurns) {
    const next = dequeueNext(scope.storage, first);
    if (next === null) {
      break;
    }
    const row = openTurn(scope, next);
    if (row !== null) {
      rows.push(row);
    }
  }
  return rows;
};

const setIdSchema = z.object({ id: z.string(), sealed_at: z.number().nullable() });

// the change set a turn's writes opened, sealed: one undoable set a turn
const sealTurnSet = (
  sql: SqlStatements,
  turn: Pick<OpenTurn, "threadId" | "turn">,
  now: number,
): string[] => {
  const ids: string[] = [];
  for (const raw of sql.all(
    "SELECT id, sealed_at FROM change_sets WHERE actor = 'agent' AND thread_id = ? AND turn = ?",
    [turn.threadId, turn.turn],
  )) {
    const set = setIdSchema.parse(raw);
    if (set.sealed_at === null) {
      sealChangeSet(sql, set.id, now);
    }
    ids.push(set.id);
  }
  return ids;
};

// a turn over: its change set sealed, every call still open booked at what it reserved, a turn
// that cost nothing given back, the links it saved let go to be read, and its row gone
const closeTurn = (scope: LandingScope, turn: OpenTurn): void => {
  const { storage, now } = scope;
  const sets = sealTurnSet(storage, turn, now);
  if (settleTurnCalls(storage, turn) === 0) {
    bookTurn(storage, dayOf(turn.startedAt), -1);
  }
  releaseHeldFills(storage, sets, now);
  dropTurn(storage, turn.threadId);
  dropJob(storage, deliverJob(turn.threadId).id);
  dropJob(storage, watchJob(turn.threadId).id);
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

// the open turn handed to its thread's object, and stopped there when the person stopped it; the
// job stays for the alarm until both landed. False when the object could not be reached
const deliverTurn = async (cell: AgentCell, threadId: string): Promise<boolean> => {
  const read = cell.library.read((sql) => {
    const turn = openTurnOf(sql, threadId);
    return turn === null ? null : { rules: filingRules(sql), turn };
  });
  if (!read.ok) {
    return false;
  }
  if (read.value === null) {
    await landRows(cell, (scope) => {
      dropJob(scope.storage, deliverJob(threadId).id);
    });
    return true;
  }
  const { rules, turn } = read.value;
  const stub = threadStub(cell.exports, cell.accountId, threadId);
  try {
    await stub.send({
      content: turnUserMessage(turn.message),
      opId: `${threadId}:${String(turn.turn)}`,
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
      deferJob(scope.storage, deliverJob(threadId).id, scope.now + DELIVER_AGAIN_MS);
    });
    return false;
  }
  await landRows(cell, (scope) => {
    // a stop asked for meanwhile is delivered by the job it asked for
    if (openTurnOf(scope.storage, threadId)?.cancel !== true || turn.cancel) {
      dropJob(scope.storage, deliverJob(threadId).id);
    }
  });
  return true;
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
  const stored: ThreadEventRow[] = [];
  const landed = cell.library.landApart(
    { answer: threadAnswerSchema, opId: input.opId },
    (scope): ThreadAnswer => {
      const { storage } = scope;
      if (!agentIsOn(storage)) {
        refuse({ kind: "agent-unavailable" });
      }
      if (turnsLeft(storage, allowance, scope.now) === 0) {
        refuse({ kind: "agent-budget", resetsAt: nextDayAt(scope.now) });
      }
      const threadId = input.threadId ?? cell.library.ids.thread();
      if (input.threadId === undefined) {
        createThread(scope, threadId, input.text);
      } else {
        knownThread(storage, threadId);
      }
      const ownOpen = openTurnOf(storage, threadId) !== null;
      if (ownOpen || openTurnCount(storage) >= allowance.concurrentTurns) {
        enqueue(storage, {
          id: cell.library.ids.queuedSend(),
          message,
          queuedAt: scope.now,
          threadId,
        });
        if (!ownOpen) {
          setThreadStatus(scope, threadId, "queued");
        }
        return { status: "queued", threadId };
      }
      const row = openTurn(scope, { message, threadId });
      if (row !== null) {
        stored.push(row);
      }
      return { status: "running", threadId };
    },
  );
  if (landed.ok && landed.value.status === "running") {
    frameEvents(cell, stored);
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

const askedRowSchema = z.object({ json: z.string() });

// the call an `approval.asked` event asked about, or null for an event that asked nothing
const askedCall = (sql: SqlStatements, threadId: string, eventId: string): string | null => {
  knownThread(sql, threadId);
  const [raw] = sql.all(
    `SELECT json FROM thread_events WHERE event_id = ? AND thread_id = ?
     AND type = 'approval.asked'`,
    [eventId, threadId],
  );
  if (raw === undefined) {
    return null;
  }
  const event = agentEventSchema.safeParse(JSON.parse(askedRowSchema.parse(raw).json));
  return event.success && event.data.type === "approval.asked" ? event.data.toolUseId : null;
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
  const read = cell.library.read((sql) => askedCall(sql, input.threadId, input.eventId));
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
    statusOf(scope.storage, input.threadId),
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
      knownThread(storage, input.threadId);
      dropQueuedFor(storage, input.threadId);
      if (openTurnOf(storage, input.threadId) === null) {
        restThread(scope, input.threadId);
      } else {
        markCancel(storage, input.threadId);
        scheduleJob(storage, deliverJob(input.threadId), scope.now);
      }
      return statusOf(storage, input.threadId);
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
  for (const threadId of everyThreadId(storage)) {
    dropQueuedFor(storage, threadId);
    if (openTurnOf(storage, threadId) === null) {
      restThread(scope, threadId);
    } else {
      markCancel(storage, threadId);
      scheduleJob(storage, deliverJob(threadId), scope.now);
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
  const read = cell.library.read((sql) => knownThread(sql, input.threadId));
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
  const opened: ThreadEventRow[] = [];
  const landed = cell.library.landApart({ answer: deletedSchema, opId: input.opId }, (scope) => {
    const { storage } = scope;
    knownThread(storage, input.threadId);
    const open = openTurnOf(storage, input.threadId);
    if (open !== null) {
      closeTurn(scope, open);
    }
    dropQueuedFor(storage, input.threadId);
    forgetPushes(storage, input.threadId);
    deleteThread(scope, input.threadId);
    opened.push(...openWaiting(scope, allowance, null));
    return { deleted: true as const };
  });
  if (landed.ok) {
    frameEvents(cell, opened);
  }
  return landed;
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

// whom a turn's tool calls write as: that turn, read again as each write lands, so a call that
// lands once its turn sealed is refused
export const turnActorOf =
  (library: LibraryEngine, named: { readonly threadId: string; readonly turn: number }) =>
  (): CellActor => {
    const open = library.read((sql) => openTurnOf(sql, named.threadId));
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
  sql: SqlStatements,
  named: { readonly threadId: string; readonly turn: number },
): TurnNamed => {
  if (threadState(sql, named.threadId) === null) {
    return { kind: "unknown-thread" };
  }
  const open = openTurnOf(sql, named.threadId);
  return open?.turn === named.turn ? { kind: "open", turn: open } : { kind: "turn-closed" };
};

const reserveOutcomeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("granted"), maxTokens: z.number() }),
  z.object({ kind: z.literal("refused") }),
  z.object({ kind: z.literal("unknown-thread") }),
  z.object({ kind: z.literal("turn-closed") }),
]);

// a model call's cap, before it is sent, recorded as its reservation; asked again for a call it
// already reserved, the same cap
export const reserveForCall = (
  cell: AgentCell,
  request: ReserveRequest,
): CellAnswer<Reservation> => {
  const parsed = reserveRequestSchema.safeParse(request);
  if (!parsed.success) {
    console.error({ event: "agent-reserve-malformed", issues: parsed.error.issues.length });
    return { ok: true, value: { kind: "refused" } };
  }
  const { callId, estimate, threadId, turn } = parsed.data;
  const allowance = allowanceOf(cell.env);
  const prices = pricesFor(pricesOf(cell.env), AGENT_MODEL.id);
  const landed = cell.library.landApart(
    { answer: reserveOutcomeSchema, opId: undefined },
    (scope): z.infer<typeof reserveOutcomeSchema> => {
      const { storage, now } = scope;
      const named = turnNamed(storage, { threadId, turn });
      if (named.kind !== "open") {
        return { kind: named.kind };
      }
      heardFrom(storage, threadId, now);
      const held = heldReservation(storage, callId);
      if (held !== null) {
        return { kind: "granted", maxTokens: held.max_tokens };
      }
      const limits = limitsOf(storage, named.turn, allowance, now);
      const answer =
        parsed.data.resend === null
          ? reservationOf(estimate, prices, limits, now)
          : resendReservationOf(estimate, prices, parsed.data.resend, limits, now);
      if (answer.kind === "refused") {
        return answer;
      }
      recordReservation(
        storage,
        {
          callId,
          maxTokens: answer.maxTokens,
          reservedUcents: answer.reservedUcents,
          threadId,
          turn,
        },
        now,
      );
      return { kind: "granted", maxTokens: answer.maxTokens };
    },
  );
  if (!landed.ok) {
    return gone();
  }
  const outcome = landed.value;
  if (outcome.kind === "unknown-thread" || outcome.kind === "turn-closed") {
    return { ok: false, refusal: outcome.kind };
  }
  return { ok: true, value: outcome };
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
      const named = turnNamed(scope.storage, call);
      if (named.kind !== "open") {
        return named.kind;
      }
      heardFrom(scope.storage, call.threadId, scope.now);
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

const pushOutcomeSchema = z.object({
  kind: z.enum(["landed", "unknown-thread", "turn-closed"]),
  rows: z.array(threadEventRowSchema),
});

const settleEntry = (
  sql: SqlStatements,
  entry: Extract<PushEntry, { readonly kind: "call" }>,
  prices: PriceTable,
): void => {
  if (entry.outcome !== "billed") {
    settleCall(sql, entry.callId, entry.outcome === "cut" ? "reserved" : "free");
    return;
  }
  const report = usageReportSchema.safeParse(entry.usage);
  if (!report.success) {
    console.error({ event: "agent-usage-malformed", issues: report.error.issues.length });
  }
  settleCall(
    sql,
    entry.callId,
    report.success ? priceUsage(report.data, entry.model, prices) : "reserved",
  );
};

// one push of a thread's object, applied once by its sequence in one transaction: its events
// stored, its calls settled, the turn's phase moved, and the turn sealed by the push that ends it
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
  const prices = pricesOf(cell.env);
  const allowance = allowanceOf(cell.env);
  const landed = cell.library.landApart(
    { answer: pushOutcomeSchema, opId: undefined },
    (scope): z.infer<typeof pushOutcomeSchema> => {
      const { storage } = scope;
      if (threadState(storage, push.threadId) === null) {
        return { kind: "unknown-thread", rows: [] };
      }
      if (push.seq <= lastPush(storage, push.threadId)) {
        return { kind: "landed", rows: [] };
      }
      recordPush(storage, push.threadId, push.seq);
      const named = turnNamed(storage, push);
      if (named.kind !== "open") {
        return { kind: "turn-closed", rows: [] };
      }
      heardFrom(storage, push.threadId, scope.now);
      const rows: ThreadEventRow[] = [];
      let ended = false;
      for (const [index, entry] of push.entries.entries()) {
        if (entry.kind === "call") {
          settleEntry(storage, entry, prices);
          continue;
        }
        const id = pushedEventId(push.threadId, push.seq, index);
        const row = storeEvent(scope, push.threadId, id, entry.event);
        if (row !== null) {
          rows.push(row);
        }
        if (entry.event.type === "approval.asked" || entry.event.type === "approval.answered") {
          const phase = moveWaiting(
            storage,
            push.threadId,
            entry.event.type === "approval.asked" ? 1 : -1,
          );
          setThreadStatus(scope, push.threadId, phase);
        }
        ended ||= entry.event.type === "turn.ended";
      }
      if (ended) {
        closeTurn(scope, named.turn);
        restThread(scope, push.threadId);
        rows.push(...openWaiting(scope, allowance, push.threadId));
      }
      return { kind: "landed", rows };
    },
  );
  if (!landed.ok) {
    return gone();
  }
  frameEvents(cell, landed.value.rows);
  await cell.settle(landed);
  const { kind } = landed.value;
  return kind === "landed" ? { ok: true, value: null } : { ok: false, refusal: kind };
};

// the reply as it is written, on the account's sockets alone: never stored, never pulled
export const showPreview = (cell: AgentCell, request: PreviewRequest): CellAnswer<null> => {
  const parsed = previewRequestSchema.safeParse(request);
  if (!parsed.success) {
    return { ok: true, value: null };
  }
  const preview = parsed.data;
  const read = cell.library.read((sql) => turnNamed(sql, preview));
  if (!read.ok) {
    return gone();
  }
  if (read.value.kind !== "open") {
    return { ok: false, refusal: read.value.kind };
  }
  cell.tell({
    event: { text: preview.text, type: "agent.preview" },
    preview: true,
    threadId: preview.threadId,
    type: "thread",
  });
  return { ok: true, value: null };
};

// ---- the alarm's ----

// a turn whose object the cell has not heard from in five minutes, asked after: the ask starts the
// object, which wakes any work an instance left
const watchTurn = async (cell: AgentCell, threadId: string): Promise<void> => {
  const read = cell.library.read((sql) => openTurnOf(sql, threadId));
  const turn = read.ok ? read.value : null;
  if (turn !== null && cell.now() - turn.heardAt >= WATCH_EVERY_MS) {
    try {
      await threadStub(cell.exports, cell.accountId, threadId).inspect();
    } catch (error) {
      console.warn({ event: "agent-watch-failed", threadId, ...errorFields(error) });
    }
  }
  await landRows(cell, (scope) => {
    if (openTurnOf(scope.storage, threadId) === null) {
      dropJob(scope.storage, watchJob(threadId).id);
    } else {
      scheduleJob(scope.storage, watchJob(threadId), scope.now + WATCH_EVERY_MS);
    }
  });
};

const AGENT_JOBS = ["agent-deliver", "agent-watch"] as const;

const runAgentJob = async (
  cell: AgentCell,
  job: DueJob<(typeof AGENT_JOBS)[number]>,
): Promise<void> => {
  const { threadId } = jobPayloadSchema.parse(JSON.parse(job.payload));
  await (job.kind === "agent-deliver" ? deliverTurn(cell, threadId) : watchTurn(cell, threadId));
};

// the agent's jobs due, each leaving its own row as it should be; one that throws is put off
export const runAgentJobs = async (cell: AgentCell): Promise<void> => {
  const due = cell.library.read((sql) => dueJobs(sql, cell.now(), AGENT_JOBS));
  if (!due.ok) {
    return;
  }
  for (const job of due.value) {
    try {
      await runAgentJob(cell, job);
    } catch (error) {
      console.error({ event: "agent-job-failed", kind: job.kind, ...errorFields(error) });
      await landRows(cell, (scope) => {
        retryJob(scope.storage, job, scope.now);
      });
    }
  }
};

// ---- the account's deletion ----

// every conversation's object the account's threads name, purged, read past the tombstone from
// the cell's own rows: what they keep goes before the cell's own rows do
export const purgeThreadObjects = async (
  sql: SqlStatements,
  exports: Cloudflare.Exports,
  accountId: string,
): Promise<void> => {
  for (const threadId of everyThreadId(sql)) {
    await threadStub(exports, accountId, threadId).purge();
  }
};
