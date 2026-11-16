// A conversation's SQLite, one per conversation's Durable Object: the transcript as Claude returned
// it, the definitions its turns are sent under, the turns its cell delivered, each reply's tool
// calls, and the outbox to its cell. A turn's row and a tool call's each store the one state they
// are in, never a column a concern. drizzle-kit exports its DDL (ddl.sql), which the conversation
// applies in its constructor. The transcript is append-only by its one insert site, never a
// trigger, which the exported DDL cannot spell, and each row holds one message's content as the
// text that was sent, so a replay is byte for byte what went before: a replayed thinking block is
// checked against everything before it.

import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// where a turn stands in the conversation: running, stopped by the person and not yet settled, or
// ended
export const THREAD_TURN_STATES = ["running", "stopping", "ended"] as const;

// where one tool call stands, the kinds of the loop's own union
// (packages/service/src/agent/tool-call.ts): journaled to run, waiting on the person until its
// row's `until`, allowed or declined by them, handed to the cell, or answered
export const TOOL_CALL_STATES = [
  "asked",
  "awaiting",
  "approved",
  "denied",
  "running",
  "answered",
] as const;

const TRANSCRIPT_ROLES = ["user", "assistant"] as const;

// a CHECK's list, spelled from the vocabulary it holds a column to
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// the conversation's one row: the last push it wrote to its outbox
export const threadMeta = sqliteTable(
  "thread_meta",
  {
    id: integer().primaryKey(),
    pushSeq: integer("push_seq").notNull().default(0),
  },
  (t) => [check("thread_meta_one", sql`${t.id} = 1`)],
);

// the model, effort, system blocks and tool definitions as sent, and the person's filing rules,
// sent after the system blocks, each row frozen at the start of the turn whose first transcript
// row is its `since_seq`; the newest is the one in force
export const threadDefinitions = sqliteTable("definition", {
  id: integer().primaryKey(),
  hash: text().notNull(),
  model: text().notNull(),
  effort: text().notNull(),
  system: text().notNull(),
  rules: text(),
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

// each turn the cell delivered, by the number it delivered it under; its message and the definition
// it is sent under are written with it. `failures` counts the tries that failed since its last
// reply landed, which is all a retry reads: the transcript says what is sent next
export const threadTurns = sqliteTable(
  "turns",
  {
    turn: integer().primaryKey(),
    state: text({ enum: THREAD_TURN_STATES }).notNull(),
    failures: integer().notNull().default(0),
  },
  (t) => [check("turns_state", sql`${t.state} IN (${oneOf(THREAD_TURN_STATES)})`)],
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
    state: text({ enum: TOOL_CALL_STATES }).notNull(),
    until: integer(),
    result: text(),
    isError: integer("is_error").notNull().default(0),
  },
  (t) => [
    index("tool_calls_message").on(t.msgSeq, t.idx),
    check("tool_calls_state", sql`${t.state} IN (${oneOf(TOOL_CALL_STATES)})`),
    check("tool_calls_until", sql`(${t.state} = 'awaiting') = (${t.until} IS NOT NULL)`),
    check("tool_calls_answer", sql`(${t.state} = 'answered') = (${t.result} IS NOT NULL)`),
    check("tool_calls_is_error", sql`${t.isError} IN (0, 1)`),
  ],
);

// what the cell has not yet acknowledged, in the order it was written: a turn's events as JSON
export const threadOutbox = sqliteTable("outbox", {
  seq: integer().primaryKey(),
  turn: integer().notNull(),
  events: text().notNull(),
});
