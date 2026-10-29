// The cell's rows of the built-in agent's conversations, read and written inside the cell's
// transactions: a thread and its status, the sessions the account holds at Anthropic, the account's
// one open turn, and the sends waiting for it. A thread and its events are synced rows, so each
// write takes the library's next sequence number and logs the change for every replica.

import { agentViewContextSchema, THREAD_STATUSES } from "@repo/contract/cloud/library/library-wire";
import { recordChanges } from "@repo/notes/library/library-queries";
import { AGENT_TURN_PHASES } from "@repo/notes/library/library-schema";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
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

const threadStateSchema = z.object({
  session_id: z.string().nullable(),
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
});

export const threadState = (sql: SqlStatements, threadId: string) => {
  const [row] = sql.all("SELECT session_id, status, title FROM threads WHERE id = ?", [threadId]);
  return row === undefined ? null : threadStateSchema.parse(row);
};

// whether the thread stored any event yet: one that never spoke is one its first send just made
export const threadSpoke = (sql: SqlStatements, threadId: string): boolean =>
  sql.all("SELECT 1 FROM thread_events WHERE thread_id = ? LIMIT 1", [threadId]).length > 0;

const titleOf = (text: string): string => {
  const line = text.split(/\r?\n/u).find((candidate) => candidate.trim() !== "") ?? "";
  const trimmed = line.trim();
  return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
};

export const createThread = (scope: LandingScope, threadId: string, text: string): void => {
  const seq = scope.seq();
  scope.storage.run(
    `INSERT INTO threads (id, session_id, title, status, created_at, updated_at, seq)
     VALUES (?, NULL, ?, 'idle', ?, ?, ?)`,
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

// the thread's session, the one its next turn continues; null starts a fresh one
export const setThreadSession = (
  scope: LandingScope,
  threadId: string,
  sessionId: string | null,
): void => {
  scope.storage.run("UPDATE threads SET session_id = ? WHERE id = ?", [sessionId, threadId]);
};

// ---- sessions ----

const sessionRowSchema = z.object({
  cached_tokens: z.number(),
  cost_cents: z.number(),
  cursor: z.string().nullable(),
  input_tokens: z.number(),
  output_tokens: z.number(),
  thread_id: z.string(),
});

export const sessionRow = (sql: SqlStatements, sessionId: string) => {
  const [row] = sql.all(
    `SELECT thread_id, cursor, cost_cents, input_tokens, cached_tokens, output_tokens
     FROM agent_sessions WHERE session_id = ?`,
    [sessionId],
  );
  return row === undefined ? null : sessionRowSchema.parse(row);
};

// a session Anthropic made for the thread, recorded before anything else is asked of it
export const holdSession = (scope: LandingScope, sessionId: string, threadId: string): void => {
  scope.storage.run(
    `INSERT INTO agent_sessions (session_id, thread_id, created_at) VALUES (?, ?, ?)
     ON CONFLICT (session_id) DO NOTHING`,
    [sessionId, threadId, scope.now],
  );
};

// a session no thread runs in any more, which waits to be deleted at Anthropic
export const dropSession = (sql: SqlStatements, sessionId: string, now: number): void => {
  sql.run("UPDATE agent_sessions SET dropped_at = ? WHERE session_id = ? AND dropped_at IS NULL", [
    now,
    sessionId,
  ]);
};

export const forgetSession = (sql: SqlStatements, sessionId: string): void => {
  sql.run("DELETE FROM agent_sessions WHERE session_id = ?", [sessionId]);
};

const sessionIdSchema = z.object({ session_id: z.string() });

// every session the account holds at Anthropic, those it let go of included
export const heldSessionIds = (sql: SqlStatements): string[] =>
  sql
    .all("SELECT session_id FROM agent_sessions ORDER BY created_at", [])
    .map((row) => sessionIdSchema.parse(row).session_id);

// every session a thread ran in, the one it runs in now included
export const threadSessionIds = (sql: SqlStatements, threadId: string): string[] =>
  sql
    .all("SELECT session_id FROM agent_sessions WHERE thread_id = ? AND dropped_at IS NULL", [
      threadId,
    ])
    .map((row) => sessionIdSchema.parse(row).session_id);

// ---- the open turn ----

export type TurnPhase = (typeof AGENT_TURN_PHASES)[number];

// why a turn ends: a final stop reason of its idle, or its session's end
const TURN_ENDS = [
  "end_turn",
  "retries_exhausted",
  "budget_reached",
  "refusal",
  "terminated",
] as const;

export type TurnEnd = (typeof TURN_ENDS)[number];

const pendingSchema = JSON_TEXT.pipe(z.array(z.string()).min(1));

const turnRowSchema = z.object({
  asked_at: z.number().nullable(),
  ends: z.enum(TURN_ENDS).nullable(),
  interrupted: z.number(),
  message: z.string(),
  pending: z.string().nullable(),
  phase: z.enum(AGENT_TURN_PHASES),
  session_id: z.string().nullable(),
  started_at: z.number(),
  thread_id: z.string(),
  turn: z.number(),
});

export interface OpenTurn {
  readonly threadId: string;
  readonly sessionId: string | null;
  readonly turn: number;
  readonly phase: TurnPhase;
  readonly message: TurnMessage;
  readonly ends: TurnEnd | null;
  // the calls the session waits on the person's answer to, and since when
  readonly pending: readonly string[];
  readonly askedAt: number | null;
  readonly interrupted: boolean;
  readonly startedAt: number;
}

export const openTurn = (sql: SqlStatements): OpenTurn | null => {
  const [raw] = sql.all(
    `SELECT thread_id, session_id, turn, phase, message, ends, pending, asked_at, interrupted,
       started_at FROM agent_turn`,
    [],
  );
  if (raw === undefined) {
    return null;
  }
  const row = turnRowSchema.parse(raw);
  return {
    askedAt: row.asked_at,
    ends: row.ends,
    interrupted: row.interrupted === 1,
    message: messageText.parse(row.message),
    pending: row.pending === null ? [] : pendingSchema.parse(row.pending),
    phase: row.phase,
    sessionId: row.session_id,
    startedAt: row.started_at,
    threadId: row.thread_id,
    turn: row.turn,
  };
};

// the actor a turn's writes are by, which every call its session makes joins
export const turnActor = (turn: Pick<OpenTurn, "threadId" | "turn">): CellActor => ({
  kind: "agent",
  label: AGENT_LABEL,
  threadId: turn.threadId,
  turn: turn.turn,
});

const turnNumberSchema = z.object({ turn: z.number().nullable() });

// the thread's next turn's number, after every change set an earlier one opened
export const nextTurnNumber = (sql: SqlStatements, threadId: string): number => {
  const [row] = sql.all("SELECT max(turn) AS turn FROM change_sets WHERE thread_id = ?", [
    threadId,
  ]);
  return (turnNumberSchema.parse(row).turn ?? 0) + 1;
};

export const insertTurn = (
  sql: SqlStatements,
  turn: {
    readonly threadId: string;
    readonly sessionId: string | null;
    readonly turn: number;
    readonly message: TurnMessage;
    readonly startedAt: number;
  },
): void => {
  sql.run(
    `INSERT INTO agent_turn (slot, thread_id, session_id, turn, phase, message, started_at)
     VALUES (1, ?, ?, ?, 'starting', ?, ?)`,
    [
      turn.threadId,
      turn.sessionId,
      turn.turn,
      JSON.stringify(turnMessageSchema.parse(turn.message)),
      turn.startedAt,
    ],
  );
};

export const setTurnSession = (sql: SqlStatements, sessionId: string | null): void => {
  sql.run("UPDATE agent_turn SET session_id = ?", [sessionId]);
};

export const setTurnRunning = (sql: SqlStatements): void => {
  sql.run("UPDATE agent_turn SET phase = 'running', pending = NULL, asked_at = NULL", []);
};

export const setTurnAwaiting = (sql: SqlStatements, pending: readonly string[], at: number) => {
  sql.run(
    "UPDATE agent_turn SET phase = 'awaiting_approval', pending = ?, asked_at = coalesce(asked_at, ?)",
    [JSON.stringify(pending), at],
  );
};

export const setTurnEnding = (sql: SqlStatements, ends: TurnEnd): void => {
  sql.run("UPDATE agent_turn SET phase = 'ending', pending = NULL, asked_at = NULL, ends = ?", [
    ends,
  ]);
};

export const markInterrupted = (sql: SqlStatements): void => {
  sql.run("UPDATE agent_turn SET interrupted = 1", []);
};

export const dropTurn = (sql: SqlStatements): void => {
  sql.run("DELETE FROM agent_turn", []);
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

// the send that has waited longest, taken off the queue
export const dequeue = (sql: SqlStatements): QueuedSend | null => {
  const [raw] = sql.all(
    "SELECT id, thread_id, message, queued_at FROM agent_queue ORDER BY queued_at, id LIMIT 1",
    [],
  );
  if (raw === undefined) {
    return null;
  }
  const row = queuedRowSchema.parse(raw);
  sql.run("DELETE FROM agent_queue WHERE id = ?", [row.id]);
  return {
    id: row.id,
    message: messageText.parse(row.message),
    queuedAt: row.queued_at,
    threadId: row.thread_id,
  };
};

const firstQueuedSchema = z.object({ first: z.number().nullable() });
const queuedThreadSchema = z.object({ thread_id: z.string() });

// a send whose turn could not start, put back where it waited: ahead of every send queued since
export const requeueFirst = (
  sql: SqlStatements,
  turn: Pick<OpenTurn, "threadId" | "message" | "startedAt">,
  id: string,
): void => {
  const [row] = sql.all("SELECT min(queued_at) AS first FROM agent_queue", []);
  const first = firstQueuedSchema.parse(row).first ?? turn.startedAt;
  enqueue(sql, {
    id,
    message: turn.message,
    queuedAt: Math.min(first, turn.startedAt) - 1,
    threadId: turn.threadId,
  });
};

export const queuedFor = (sql: SqlStatements, threadId: string): number =>
  sql.all("SELECT id FROM agent_queue WHERE thread_id = ?", [threadId]).length;

export const queueWaits = (sql: SqlStatements): boolean =>
  sql.all("SELECT 1 FROM agent_queue LIMIT 1", []).length > 0;

// every send waiting, which a turned-off agent lets go of, by thread
export const dropQueue = (sql: SqlStatements): string[] => {
  const threads = sql
    .all("SELECT DISTINCT thread_id FROM agent_queue", [])
    .map((row) => queuedThreadSchema.parse(row).thread_id);
  sql.run("DELETE FROM agent_queue", []);
  return threads;
};

export const dropQueuedFor = (sql: SqlStatements, threadId: string): void => {
  sql.run("DELETE FROM agent_queue WHERE thread_id = ?", [threadId]);
};

// a thread that must exist for the call to mean anything
export const knownThread = (sql: SqlStatements, threadId: string) =>
  threadState(sql, threadId) ?? refuse({ kind: "not-found" });
