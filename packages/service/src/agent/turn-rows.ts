// The cell's rows of the built-in agent's conversations, read and written inside the cell's
// transactions: a thread and its status, each thread's one open turn, the sends waiting for a turn,
// the last push each thread's object landed, and the switch. A thread's status is what its open
// turn and its queued sends say, written by `restatus` alone. Each write of a thread or its events
// names the thread in the moved frame its commit sends; the rest are the cell's alone.

import { agentViewContextSchema, THREAD_STATUSES } from "@repo/contract/library/library-wire";
import { and, count, eq, notInArray, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { SQLiteTable } from "drizzle-orm/sqlite-core";
import { z } from "zod";

import {
  agentPushes,
  agentQueue,
  agentSwitch,
  agentTurns,
  threadEvents,
  threads,
} from "@repo/db/cell/schema";
import type { CellActor } from "../library/cell-actor";
import { excluded } from "../library/cell-db";
import type { CellDb } from "../library/cell-db";
import type { LandingScope } from "../library/cell-landing";
import { refuse } from "../library/cell-refusal";
import { jsonTextSchema } from "../library/sql-value";

type ThreadStatus = (typeof THREAD_STATUSES)[number];

// the built-in agent's change sets' label
const AGENT_LABEL = "Agent";

// a thread's name: its first message's first line, as long as a row shows
const TITLE_MAX = 80;

// ---- a message ----

// what a send carries into its turn: the person's words, and the screen they wrote from
const turnMessageSchema = z.object({
  text: z.string().min(1),
  viewContext: agentViewContextSchema.nullable(),
});

export type TurnMessage = z.infer<typeof turnMessageSchema>;

const messageText = jsonTextSchema.pipe(turnMessageSchema);

// ---- threads ----

const statusSchema = z.enum(THREAD_STATUSES);

export const storedStatus = (db: CellDb, threadId: string): ThreadStatus | null => {
  const row = db
    .select({ status: threads.status })
    .from(threads)
    .where(eq(threads.id, threadId))
    .get();
  return row === undefined ? null : statusSchema.parse(row.status);
};

// a thread that must exist for the call to mean anything
export const knownThread = (db: CellDb, threadId: string): ThreadStatus =>
  storedStatus(db, threadId) ?? refuse({ kind: "not-found" });

const countOf = (db: CellDb, table: SQLiteTable, where?: SQL): number =>
  db.select({ count: count() }).from(table).where(where).get()?.count ?? 0;

const titleOf = (text: string): string => {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
};

export const createThread = (scope: LandingScope, threadId: string, text: string): void => {
  scope.storage.db
    .insert(threads)
    .values({
      createdAt: scope.now,
      id: threadId,
      status: "idle",
      title: titleOf(text),
      updatedAt: scope.now,
    })
    .run();
  scope.moved.thread(threadId);
};

export const everyThreadId = (db: CellDb): string[] =>
  db
    .select({ id: threads.id })
    .from(threads)
    .orderBy(threads.id)
    .all()
    .map(({ id }) => id);

// ---- the open turns ----

export interface OpenTurn {
  readonly threadId: string;
  readonly turn: number;
  readonly message: TurnMessage;
  // the calls of the turn waiting on the person
  readonly waiting: number;
  readonly cancel: boolean;
  readonly startedAt: number;
  // when its conversation's object last called
  readonly heardAt: number;
}

export const openTurnOf = (db: CellDb, threadId: string): OpenTurn | null => {
  const row = db.select().from(agentTurns).where(eq(agentTurns.threadId, threadId)).get();
  return row === undefined
    ? null
    : { ...row, cancel: row.cancel === 1, message: messageText.parse(row.message) };
};

// the actor a turn's writes are by, which every call it runs joins
export const turnActor = (turn: Pick<OpenTurn, "threadId" | "turn">): CellActor => ({
  kind: "agent",
  label: AGENT_LABEL,
  threadId: turn.threadId,
  turn: turn.turn,
});

// the thread's next turn's number: one past every turn it opened, each of which kept the person's
// message as its event, which only the thread's deletion takes
export const nextTurnNumber = (db: CellDb, threadId: string): number =>
  countOf(
    db,
    threadEvents,
    and(eq(threadEvents.threadId, threadId), eq(threadEvents.type, "user.message")),
  ) + 1;

export const insertTurn = (
  db: CellDb,
  turn: {
    readonly threadId: string;
    readonly turn: number;
    readonly message: TurnMessage;
    readonly at: number;
  },
): void => {
  db.insert(agentTurns)
    .values({
      heardAt: turn.at,
      message: JSON.stringify(turnMessageSchema.parse(turn.message)),
      startedAt: turn.at,
      threadId: turn.threadId,
      turn: turn.turn,
    })
    .run();
};

// the turn's object called: what the watch job asks after
export const heardFrom = (db: CellDb, threadId: string, now: number): void => {
  db.update(agentTurns).set({ heardAt: now }).where(eq(agentTurns.threadId, threadId)).run();
};

// a call of the turn began waiting on the person, or stopped waiting; an answer with no call
// waiting moves nothing, so a second answer to one ask never hides the next ask
export const moveWaiting = (db: CellDb, threadId: string, by: 1 | -1): void => {
  const moved = sql`${agentTurns.waiting} + ${by}`;
  db.update(agentTurns)
    .set({ waiting: moved })
    .where(and(eq(agentTurns.threadId, threadId), sql`${moved} >= 0`))
    .run();
};

export const markCancel = (db: CellDb, threadId: string): void => {
  db.update(agentTurns).set({ cancel: 1 }).where(eq(agentTurns.threadId, threadId)).run();
};

export const dropTurn = (db: CellDb, threadId: string): void => {
  db.delete(agentTurns).where(eq(agentTurns.threadId, threadId)).run();
};

export const openTurnCount = (db: CellDb): number => countOf(db, agentTurns);

// ---- the queue ----

export interface QueuedSend {
  readonly id: string;
  readonly threadId: string;
  readonly message: TurnMessage;
  readonly queuedAt: number;
}

export const enqueue = (db: CellDb, send: QueuedSend): void => {
  db.insert(agentQueue)
    .values({ ...send, message: JSON.stringify(turnMessageSchema.parse(send.message)) })
    .run();
};

// the send that has waited longest of a thread with no open turn, of `thread` when it names one
const nextWaiting = (db: CellDb, thread?: SQL) =>
  db
    .select()
    .from(agentQueue)
    .where(
      and(
        thread,
        notInArray(agentQueue.threadId, db.select({ id: agentTurns.threadId }).from(agentTurns)),
      ),
    )
    .orderBy(agentQueue.queuedAt, agentQueue.id)
    .get();

// the send that has waited longest of a thread with no open turn, the thread `first` names
// before any other, taken off the queue
export const dequeueNext = (db: CellDb, first: string | null): QueuedSend | null => {
  const row =
    (first === null ? undefined : nextWaiting(db, eq(agentQueue.threadId, first))) ??
    nextWaiting(db);
  if (row === undefined) {
    return null;
  }
  db.delete(agentQueue).where(eq(agentQueue.id, row.id)).run();
  return { ...row, message: messageText.parse(row.message) };
};

export const dropQueuedFor = (db: CellDb, threadId: string): void => {
  db.delete(agentQueue).where(eq(agentQueue.threadId, threadId)).run();
};

// ---- a thread's status ----

// waiting on the person while a call of its open turn waits, running while a turn is open, queued
// behind a send of its own, else idle
export const threadStatusOf = (rows: {
  readonly open: Pick<OpenTurn, "waiting"> | null;
  readonly queued: number;
}): ThreadStatus => {
  if (rows.open !== null) {
    return rows.open.waiting > 0 ? "awaiting_approval" : "running";
  }
  return rows.queued > 0 ? "queued" : "idle";
};

// the thread's status as its rows say it now, after any change to its turn or its queue
export const restatus = (scope: LandingScope, threadId: string): void => {
  const { db } = scope.storage;
  const held = storedStatus(db, threadId);
  const status = threadStatusOf({
    open: openTurnOf(db, threadId),
    queued: countOf(db, agentQueue, eq(agentQueue.threadId, threadId)),
  });
  if (held === null || held === status) {
    return;
  }
  db.update(threads).set({ status, updatedAt: scope.now }).where(eq(threads.id, threadId)).run();
  scope.moved.thread(threadId);
};

// ---- pushes ----

export const lastPush = (db: CellDb, threadId: string): number =>
  db
    .select({ seq: agentPushes.seq })
    .from(agentPushes)
    .where(eq(agentPushes.threadId, threadId))
    .get()?.seq ?? 0;

export const recordPush = (db: CellDb, threadId: string, seq: number): void => {
  db.insert(agentPushes)
    .values({ seq, threadId })
    .onConflictDoUpdate({
      set: { seq: sql`max(${agentPushes.seq}, ${excluded(agentPushes.seq)})` },
      target: agentPushes.threadId,
    })
    .run();
};

export const forgetPushes = (db: CellDb, threadId: string): void => {
  db.delete(agentPushes).where(eq(agentPushes.threadId, threadId)).run();
};

// ---- the switch ----

// on unless the person turned it off: there is nothing to make for it to be on
export const agentIsOn = (db: CellDb): boolean =>
  (db
    .select({ enabled: agentSwitch.enabled })
    .from(agentSwitch)
    .where(eq(agentSwitch.slot, 1))
    .get()?.enabled ?? 1) === 1;

export const setSwitch = (db: CellDb, enabled: boolean): void => {
  db.insert(agentSwitch)
    .values({ enabled: enabled ? 1 : 0, slot: 1 })
    .onConflictDoUpdate({
      set: { enabled: excluded(agentSwitch.enabled) },
      target: agentSwitch.slot,
    })
    .run();
};
