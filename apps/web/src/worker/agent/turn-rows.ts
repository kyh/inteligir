// The cell's rows of the built-in agent's conversations, read and written inside the cell's
// transactions: a thread and its status, each thread's one open turn, the sends waiting for a turn,
// the last push each thread's object landed, and the switch. A thread and its events are synced
// rows, so each write of one takes the library's next sequence number and logs the change for
// every replica; the rest are the cell's alone.

import { agentViewContextSchema, THREAD_STATUSES } from "@repo/contract/cloud/library/library-wire";
import { recordChanges } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlRow, SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { CellActor } from "../library/cell-actor";
import type { LandingScope } from "../library/cell-landing";
import { refuse } from "../library/cell-refusal";

export type ThreadStatus = (typeof THREAD_STATUSES)[number];

// History's words for the built-in agent's change sets
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

const JSON_TEXT = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

const messageText = JSON_TEXT.pipe(turnMessageSchema);

// ---- threads ----

const threadStateSchema = z.object({ status: z.enum(THREAD_STATUSES), title: z.string() });

export const threadState = (sql: SqlStatements, threadId: string) => {
  const [row] = sql.all("SELECT status, title FROM threads WHERE id = ?", [threadId]);
  return row === undefined ? null : threadStateSchema.parse(row);
};

// a thread that must exist for the call to mean anything
export const knownThread = (sql: SqlStatements, threadId: string) =>
  threadState(sql, threadId) ?? refuse({ kind: "not-found" });

const titleOf = (text: string): string => {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
};

export const createThread = (scope: LandingScope, threadId: string, text: string): void => {
  const seq = scope.seq();
  scope.storage.run(
    `INSERT INTO threads (id, title, status, created_at, updated_at, seq)
     VALUES (?, ?, 'idle', ?, ?, ?)`,
    [threadId, titleOf(text), scope.now, scope.now, seq],
  );
  runPlan(scope.storage, recordChanges([{ gone: false, id: threadId, kind: "thread", seq }]));
};

// a thread's status moved, and with it its sequence, so every replica reads the new one
export const setThreadStatus = (
  scope: LandingScope,
  threadId: string,
  status: ThreadStatus,
): void => {
  const held = threadState(scope.storage, threadId);
  if (held === null || held.status === status) {
    return;
  }
  const seq = scope.seq();
  scope.storage.run("UPDATE threads SET status = ?, updated_at = ?, seq = ? WHERE id = ?", [
    status,
    scope.now,
    seq,
    threadId,
  ]);
  runPlan(scope.storage, recordChanges([{ gone: false, id: threadId, kind: "thread", seq }]));
};

const idSchema = z.object({ id: z.string() });

export const everyThreadId = (sql: SqlStatements): string[] =>
  sql.all("SELECT id FROM threads ORDER BY id", []).map((row) => idSchema.parse(row).id);

// ---- the open turns ----

const turnRowSchema = z.object({
  cancel: z.number(),
  heard_at: z.number(),
  message: z.string(),
  started_at: z.number(),
  thread_id: z.string(),
  turn: z.number(),
  waiting: z.number(),
});

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

const TURN_COLUMNS = "thread_id, turn, message, waiting, cancel, started_at, heard_at";

const openTurnFrom = (raw: SqlRow): OpenTurn => {
  const row = turnRowSchema.parse(raw);
  return {
    cancel: row.cancel === 1,
    heardAt: row.heard_at,
    message: messageText.parse(row.message),
    startedAt: row.started_at,
    threadId: row.thread_id,
    turn: row.turn,
    waiting: row.waiting,
  };
};

export const openTurnOf = (sql: SqlStatements, threadId: string): OpenTurn | null => {
  const [raw] = sql.all(`SELECT ${TURN_COLUMNS} FROM agent_turns WHERE thread_id = ?`, [threadId]);
  return raw === undefined ? null : openTurnFrom(raw);
};

// the actor a turn's writes are by, which every call it runs joins
export const turnActor = (turn: Pick<OpenTurn, "threadId" | "turn">): CellActor => ({
  kind: "agent",
  label: AGENT_LABEL,
  threadId: turn.threadId,
  turn: turn.turn,
});

const countSchema = z.object({ count: z.number() });

// the thread's next turn's number: one past every turn it opened, each of which kept the person's
// message as its event, which only the thread's deletion takes
export const nextTurnNumber = (sql: SqlStatements, threadId: string): number => {
  const [row] = sql.all(
    "SELECT count(*) AS count FROM thread_events WHERE thread_id = ? AND type = 'user.message'",
    [threadId],
  );
  return countSchema.parse(row).count + 1;
};

export const insertTurn = (
  sql: SqlStatements,
  turn: {
    readonly threadId: string;
    readonly turn: number;
    readonly message: TurnMessage;
    readonly at: number;
  },
): void => {
  sql.run(
    `INSERT INTO agent_turns (thread_id, turn, message, waiting, cancel, started_at, heard_at)
     VALUES (?, ?, ?, 0, 0, ?, ?)`,
    [
      turn.threadId,
      turn.turn,
      JSON.stringify(turnMessageSchema.parse(turn.message)),
      turn.at,
      turn.at,
    ],
  );
};

// the turn's object called: what the watch job asks after
export const heardFrom = (sql: SqlStatements, threadId: string, now: number): void => {
  sql.run("UPDATE agent_turns SET heard_at = ? WHERE thread_id = ?", [now, threadId]);
};

// a call of the turn began waiting on the person, or stopped waiting; what that leaves the thread
export const moveWaiting = (sql: SqlStatements, threadId: string, by: 1 | -1): ThreadStatus => {
  sql.run("UPDATE agent_turns SET waiting = max(0, waiting + ?) WHERE thread_id = ?", [
    by,
    threadId,
  ]);
  return (openTurnOf(sql, threadId)?.waiting ?? 0) > 0 ? "awaiting_approval" : "running";
};

export const markCancel = (sql: SqlStatements, threadId: string): void => {
  sql.run("UPDATE agent_turns SET cancel = 1 WHERE thread_id = ?", [threadId]);
};

export const dropTurn = (sql: SqlStatements, threadId: string): void => {
  sql.run("DELETE FROM agent_turns WHERE thread_id = ?", [threadId]);
};

export const openTurnCount = (sql: SqlStatements): number => {
  const [row] = sql.all("SELECT count(*) AS count FROM agent_turns", []);
  return countSchema.parse(row).count;
};

// ---- the queue ----

const queuedRowSchema = z.object({
  id: z.string(),
  message: z.string(),
  queued_at: z.number(),
  thread_id: z.string(),
});

export interface QueuedSend {
  readonly id: string;
  readonly threadId: string;
  readonly message: TurnMessage;
  readonly queuedAt: number;
}

export const enqueue = (sql: SqlStatements, send: QueuedSend): void => {
  sql.run("INSERT INTO agent_queue (id, thread_id, message, queued_at) VALUES (?, ?, ?, ?)", [
    send.id,
    send.threadId,
    JSON.stringify(turnMessageSchema.parse(send.message)),
    send.queuedAt,
  ]);
};

const queuedFrom = (raw: SqlRow): QueuedSend => {
  const row = queuedRowSchema.parse(raw);
  return {
    id: row.id,
    message: messageText.parse(row.message),
    queuedAt: row.queued_at,
    threadId: row.thread_id,
  };
};

// the send that has waited longest of a thread with no open turn, the thread `first` names
// before any other, taken off the queue
export const dequeueNext = (sql: SqlStatements, first: string | null): QueuedSend | null => {
  const [own] =
    first === null
      ? []
      : sql.all(
          `SELECT id, thread_id, message, queued_at FROM agent_queue WHERE thread_id = ?
           AND thread_id NOT IN (SELECT thread_id FROM agent_turns) ORDER BY queued_at, id LIMIT 1`,
          [first],
        );
  const [raw] =
    own === undefined
      ? sql.all(
          `SELECT id, thread_id, message, queued_at FROM agent_queue
           WHERE thread_id NOT IN (SELECT thread_id FROM agent_turns) ORDER BY queued_at, id
           LIMIT 1`,
          [],
        )
      : [own];
  if (raw === undefined) {
    return null;
  }
  const send = queuedFrom(raw);
  sql.run("DELETE FROM agent_queue WHERE id = ?", [send.id]);
  return send;
};

export const queuedFor = (sql: SqlStatements, threadId: string): number => {
  const [row] = sql.all("SELECT count(*) AS count FROM agent_queue WHERE thread_id = ?", [
    threadId,
  ]);
  return countSchema.parse(row).count;
};

export const dropQueuedFor = (sql: SqlStatements, threadId: string): void => {
  sql.run("DELETE FROM agent_queue WHERE thread_id = ?", [threadId]);
};

// ---- pushes ----

const pushSeqSchema = z.object({ seq: z.number() });

export const lastPush = (sql: SqlStatements, threadId: string): number => {
  const [row] = sql.all("SELECT seq FROM agent_pushes WHERE thread_id = ?", [threadId]);
  return row === undefined ? 0 : pushSeqSchema.parse(row).seq;
};

export const recordPush = (sql: SqlStatements, threadId: string, seq: number): void => {
  sql.run(
    `INSERT INTO agent_pushes (thread_id, seq) VALUES (?, ?)
     ON CONFLICT (thread_id) DO UPDATE SET seq = max(seq, excluded.seq)`,
    [threadId, seq],
  );
};

export const forgetPushes = (sql: SqlStatements, threadId: string): void => {
  sql.run("DELETE FROM agent_pushes WHERE thread_id = ?", [threadId]);
};

// ---- the switch ----

const switchSchema = z.object({ enabled: z.number() });

// on unless the person turned it off: there is nothing to make for it to be on
export const agentIsOn = (sql: SqlStatements): boolean => {
  const [row] = sql.all("SELECT enabled FROM agent_switch WHERE slot = 1", []);
  return row === undefined || switchSchema.parse(row).enabled === 1;
};

export const setSwitch = (sql: SqlStatements, enabled: boolean): void => {
  sql.run(
    `INSERT INTO agent_switch (slot, enabled) VALUES (1, ?)
     ON CONFLICT (slot) DO UPDATE SET enabled = excluded.enabled`,
    [enabled ? 1 : 0],
  );
};
