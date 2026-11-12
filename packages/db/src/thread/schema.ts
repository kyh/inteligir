// A conversation's SQLite, one per conversation's Durable Object: the transcript as Claude returned
// it, the definitions its turns are sent under, the turns its cell delivered, each step's model
// calls and tool calls, and the outbox to its cell. drizzle-kit exports its DDL (ddl.sql), which
// the conversation applies in its constructor. The transcript is append-only by its one insert
// site, never a trigger, which the exported DDL cannot spell, and each row holds one message's
// content as the text that was sent, so a replay is byte for byte what went before: a replayed
// thinking block is checked against everything before it.

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// where a turn stands in the conversation: running, waiting on the person, or ended
export const THREAD_TURN_STATUSES = ["running", "awaiting_approval", "ended"] as const;

// where one model call stands: streaming while this instance reads it; done once its reply landed;
// cut when an instance died reading it; failed or cancelled, whether it went out or not
export const MODEL_CALL_STATUSES = ["streaming", "done", "cut", "failed", "cancelled"] as const;

// where one tool call stands: journaled, waiting on the person, running, or answered
export const TOOL_CALL_STATUSES = ["pending", "awaiting_approval", "running", "done"] as const;

const TRANSCRIPT_ROLES = ["user", "assistant", "system"] as const;

const TOOL_DECISIONS = ["approved", "denied"] as const;

// a CHECK's list, spelled from the vocabulary it holds a column to
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// the conversation's one row: the last push it wrote to its outbox, and the filing rules its
// transcript last carried, null for none, '' while a change of them is owed, else their hash
export const threadMeta = sqliteTable(
  "thread_meta",
  {
    id: integer().primaryKey(),
    pushSeq: integer("push_seq").notNull().default(0),
    rulesHash: text("rules_hash"),
  },
  (t) => [check("thread_meta_one", sql`${t.id} = 1`)],
);

// the model, effort, system blocks and tool definitions as sent, each row frozen at the start of
// the turn whose first transcript row is its `since_seq`; the newest is the one in force
export const threadDefinitions = sqliteTable("definition", {
  id: integer().primaryKey(),
  hash: text().notNull(),
  model: text().notNull(),
  effort: text().notNull(),
  system: text().notNull(),
  tools: text().notNull(),
  sinceSeq: integer("since_seq").notNull().unique(),
});

export const threadTranscript = sqliteTable(
  "transcript",
  {
    seq: integer().primaryKey(),
    turn: integer().notNull(),
    role: text({ enum: TRANSCRIPT_ROLES }).notNull(),
    content: text().notNull(),
  },
  (t) => [check("transcript_role", sql`${t.role} IN (${oneOf(TRANSCRIPT_ROLES)})`)],
);

// each turn the cell delivered, by the id it delivered it under: the person's message and the
// filing rules it came with, and whether its first rows are in the transcript yet
export const threadTurns = sqliteTable(
  "turns",
  {
    turn: integer().primaryKey(),
    opId: text("op_id").notNull().unique(),
    content: text().notNull(),
    rules: text(),
    rulesHash: text("rules_hash"),
    status: text({ enum: THREAD_TURN_STATUSES }).notNull(),
    started: integer().notNull().default(0),
    cancelRequested: integer("cancel_requested").notNull().default(0),
  },
  (t) => [
    check("turns_status", sql`${t.status} IN (${oneOf(THREAD_TURN_STATUSES)})`),
    check("turns_started", sql`${t.started} IN (0, 1)`),
    check("turns_cancel_requested", sql`${t.cancelRequested} IN (0, 1)`),
  ],
);

// each send of a step, the isolate that read it, and the hash of what it asked, none for a call
// never sent
export const modelCalls = sqliteTable(
  "model_calls",
  {
    callId: text("call_id").primaryKey(),
    turn: integer().notNull(),
    step: integer().notNull(),
    attempt: integer().notNull(),
    status: text({ enum: MODEL_CALL_STATUSES }).notNull(),
    isolate: text().notNull(),
    requestSha: text("request_sha"),
  },
  (t) => [
    index("model_calls_step").on(t.turn, t.step, t.attempt),
    check("model_calls_status", sql`${t.status} IN (${oneOf(MODEL_CALL_STATUSES)})`),
  ],
);

export const toolCalls = sqliteTable(
  "tool_calls",
  {
    toolUseId: text("tool_use_id").primaryKey(),
    turn: integer().notNull(),
    msgSeq: integer("msg_seq").notNull(),
    idx: integer().notNull(),
    name: text().notNull(),
    input: text().notNull(),
    status: text({ enum: TOOL_CALL_STATUSES }).notNull(),
    decision: text({ enum: TOOL_DECISIONS }),
    reason: text(),
    attempts: integer().notNull().default(0),
    result: text(),
    isError: integer("is_error").notNull().default(0),
  },
  (t) => [
    index("tool_calls_message").on(t.msgSeq, t.idx),
    check("tool_calls_status", sql`${t.status} IN (${oneOf(TOOL_CALL_STATUSES)})`),
    check("tool_calls_decision", sql`${t.decision} IN (${oneOf(TOOL_DECISIONS)})`),
    check("tool_calls_is_error", sql`${t.isError} IN (0, 1)`),
  ],
);

// what the cell has not yet acknowledged, in the order it was written
export const threadOutbox = sqliteTable("outbox", {
  seq: integer().primaryKey(),
  json: text().notNull(),
});
