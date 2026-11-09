// A conversation's object's own tables (`./agent-thread`). The transcript is append-only, its
// triggers refusing every UPDATE and DELETE, and each row holds one message's content exactly as
// Claude returned it or the thread wrote it, so a replay is byte for byte what was sent before: a
// replayed thinking block is checked against everything before it. A definition row is the model,
// effort, system and tools the thread's turns are sent under, replayed as they were, from the
// transcript row its `since_seq` names on: the first at the thread's first turn, and another at
// the start of the first turn after a deploy changed them. No live preview is stored. Versioned
// by the `schema` row of `meta`: an object that finds another version drops its tables and starts
// over (AGENTS.md, no users yet), keeping only its push sequence, since its cell acknowledges a
// sequence it has seen without reading the push again; a turn the cell holds open that the object
// no longer does, the cell hands it again (`./agent-turns`).

import type { SqlPort } from "../library/library-sql";
import { z } from "zod";

const THREAD_SCHEMA_VERSION = 4;

// where one model call stands: streaming while this instance reads it; done once its reply landed;
// cut when an instance died reading it; refused when the allowance held none for it; failed or
// cancelled, whether it went out or not
const MODEL_CALL_STATUSES = ["streaming", "done", "cut", "refused", "failed", "cancelled"] as const;

// where one tool call stands: journaled, waiting on the person, running, or answered
const TOOL_CALL_STATUSES = ["pending", "awaiting_approval", "running", "done"] as const;

// where a turn stands in the thread: running, waiting on the person, or ended
export const THREAD_TURN_STATUSES = ["running", "awaiting_approval", "ended"] as const;

const oneOf = (values: readonly string[]): string => values.map((value) => `'${value}'`).join(", ");

const DDL = [
  `CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT NOT NULL) STRICT`,
  // the model, effort, system blocks and tool definitions as sent, each row frozen at the start
  // of the turn whose first transcript row is its since_seq; the newest is the one in force
  `CREATE TABLE IF NOT EXISTS definition (
    id INTEGER PRIMARY KEY,
    hash TEXT NOT NULL,
    model TEXT NOT NULL,
    effort TEXT NOT NULL,
    system TEXT NOT NULL,
    tools TEXT NOT NULL,
    since_seq INTEGER NOT NULL UNIQUE
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS transcript (
    seq INTEGER PRIMARY KEY,
    turn INTEGER NOT NULL,
    role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL
  ) STRICT`,
  `CREATE TRIGGER IF NOT EXISTS transcript_no_update BEFORE UPDATE ON transcript
    BEGIN SELECT RAISE(ABORT, 'the transcript is append-only'); END`,
  `CREATE TRIGGER IF NOT EXISTS transcript_no_delete BEFORE DELETE ON transcript
    BEGIN SELECT RAISE(ABORT, 'the transcript is append-only'); END`,
  // each turn the cell delivered, by the id it delivered it under: the person's message and the
  // filing rules it came with, and whether its first rows are in the transcript yet
  `CREATE TABLE IF NOT EXISTS turns (
    turn INTEGER PRIMARY KEY,
    op_id TEXT NOT NULL UNIQUE,
    content TEXT NOT NULL,
    rules TEXT,
    rules_hash TEXT,
    status TEXT NOT NULL CHECK (status IN (${oneOf(THREAD_TURN_STATUSES)})),
    started INTEGER NOT NULL DEFAULT 0 CHECK (started IN (0, 1)),
    cancel_requested INTEGER NOT NULL DEFAULT 0 CHECK (cancel_requested IN (0, 1))
  ) STRICT`,
  `CREATE TABLE IF NOT EXISTS model_calls (
    call_id TEXT PRIMARY KEY,
    turn INTEGER NOT NULL,
    step INTEGER NOT NULL,
    attempt INTEGER NOT NULL,
    status TEXT NOT NULL CHECK (status IN (${oneOf(MODEL_CALL_STATUSES)})),
    isolate TEXT NOT NULL,
    -- none of these three for a call never sent: the hash of what it asked, the cap it went out
    -- with, and the last transcript row its prompt holds, its reply's once that lands
    request_sha TEXT,
    max_tokens INTEGER,
    covered_seq INTEGER,
    -- what its reply was billed, and when it landed
    usage TEXT,
    ended_at INTEGER
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS model_calls_step ON model_calls (turn, step, attempt)`,
  `CREATE TABLE IF NOT EXISTS tool_calls (
    tool_use_id TEXT PRIMARY KEY,
    turn INTEGER NOT NULL,
    msg_seq INTEGER NOT NULL,
    idx INTEGER NOT NULL,
    name TEXT NOT NULL,
    input TEXT NOT NULL,
    status TEXT NOT NULL CHECK (status IN (${oneOf(TOOL_CALL_STATUSES)})),
    decision TEXT CHECK (decision IN ('approved', 'denied')),
    reason TEXT,
    attempts INTEGER NOT NULL DEFAULT 0,
    result TEXT,
    is_error INTEGER NOT NULL DEFAULT 0 CHECK (is_error IN (0, 1))
  ) STRICT`,
  `CREATE INDEX IF NOT EXISTS tool_calls_message ON tool_calls (msg_seq, idx)`,
  // what the cell has not yet acknowledged, in the order it was written
  `CREATE TABLE IF NOT EXISTS outbox (seq INTEGER PRIMARY KEY, json TEXT NOT NULL) STRICT`,
];

const versionRowSchema = z.object({ v: z.string() });

// the tables, made or kept; another version's are dropped first, the conversation with them, and
// every meta row but the push sequence, which never goes back
export const openThreadSchema = (sql: SqlPort): void => {
  sql.transaction(() => {
    sql.run(DDL[0] ?? "", []);
    const [row] = sql.all("SELECT v FROM meta WHERE k = 'schema'", []);
    const found = row === undefined ? null : versionRowSchema.parse(row).v;
    if (found !== null && found !== String(THREAD_SCHEMA_VERSION)) {
      for (const table of ["definition", "transcript", "turns", "model_calls", "tool_calls"]) {
        sql.run(`DROP TABLE IF EXISTS ${table}`, []);
      }
      sql.run("DROP TABLE IF EXISTS outbox", []);
      sql.run("DELETE FROM meta WHERE k != 'push_seq'", []);
    }
    for (const statement of DDL) {
      sql.run(statement, []);
    }
    sql.run("INSERT OR IGNORE INTO meta (k, v) VALUES ('schema', ?)", [
      String(THREAD_SCHEMA_VERSION),
    ]);
  });
};
