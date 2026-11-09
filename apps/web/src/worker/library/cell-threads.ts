// The account's conversations with the built-in agent, as the cell keeps them: a thread row and
// the final events of its turns. Listing and paging read them; deleting a thread removes its rows.

import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { THREAD_STATUSES } from "@repo/contract/library/library-wire";
import type { SqlRow, SqlStatements } from "@repo/service/library/library-sql";
import { jsonTextSchema } from "@repo/service/library/sql-value";
import { z } from "zod";

import type { LandingScope } from "./cell-landing";
import { offsetOf } from "./cell-reads";
import { refuse } from "./cell-refusal";

type ThreadRow = z.infer<typeof threadRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const threadSqlSchema = z.object({
  created_at: z.number(),
  id: z.string(),
  seq: z.number(),
  status: z.enum(THREAD_STATUSES),
  title: z.string(),
  updated_at: z.number(),
});

const threadEventSqlSchema = z.object({
  at: z.number(),
  event_id: z.string(),
  idx: z.number(),
  json: z.string(),
  seq: z.number(),
  thread_id: z.string(),
  type: z.string(),
});

const THREAD_COLUMNS = "id, title, status, created_at, updated_at, seq";

const threadRowFrom = (raw: SqlRow): ThreadRow => {
  const row = threadSqlSchema.parse(raw);
  return {
    createdAt: row.created_at,
    id: row.id,
    seq: row.seq,
    status: row.status,
    title: row.title,
    updatedAt: row.updated_at,
  };
};

const THREAD_EVENT_COLUMNS = "event_id, thread_id, idx, type, json, at, seq";

const threadEventRowFrom = (raw: SqlRow): ThreadEventRow => {
  const row = threadEventSqlSchema.parse(raw);
  return {
    at: row.at,
    event: jsonTextSchema.parse(row.json),
    eventId: row.event_id,
    idx: row.idx,
    seq: row.seq,
    threadId: row.thread_id,
    type: row.type,
  };
};

export const threadEventRowOf = (sql: SqlStatements, id: string): ThreadEventRow | null => {
  const [raw] = sql.all(`SELECT ${THREAD_EVENT_COLUMNS} FROM thread_events WHERE event_id = ?`, [
    id,
  ]);
  return raw === undefined ? null : threadEventRowFrom(raw);
};

const threadExists = (sql: SqlStatements, threadId: string): boolean =>
  sql.all("SELECT 1 FROM threads WHERE id = ?", [threadId]).length > 0;

// the newest-touched first
export const listThreads = (
  sql: SqlStatements,
  input: { readonly cursor?: string | undefined; readonly limit: number },
) => {
  const offset = offsetOf(input.cursor);
  const rows = sql
    .all(
      `SELECT ${THREAD_COLUMNS} FROM threads ORDER BY updated_at DESC, id DESC LIMIT ? OFFSET ?`,
      [input.limit + 1, offset],
    )
    .map(threadRowFrom);
  return {
    cursor: rows.length > input.limit ? String(offset + input.limit) : null,
    threads: rows.slice(0, input.limit),
  };
};

// a thread's stored events after position `after`, in order
export const threadEvents = (
  sql: SqlStatements,
  input: { readonly threadId: string; readonly after?: number | undefined; readonly limit: number },
) => {
  if (!threadExists(sql, input.threadId)) {
    return refuse({ kind: "not-found" });
  }
  const rows = sql
    .all(
      `SELECT ${THREAD_EVENT_COLUMNS} FROM thread_events WHERE thread_id = ? AND idx > ?
       ORDER BY idx LIMIT ?`,
      [input.threadId, input.after ?? -1, input.limit + 1],
    )
    .map(threadEventRowFrom);
  return { events: rows.slice(0, input.limit), more: rows.length > input.limit };
};

// the thread and every event it stored
export const deleteThread = (scope: LandingScope, threadId: string): void => {
  const { storage } = scope;
  if (!threadExists(storage, threadId)) {
    refuse({ kind: "not-found" });
  }
  storage.run("DELETE FROM thread_events WHERE thread_id = ?", [threadId]);
  storage.run("DELETE FROM threads WHERE id = ?", [threadId]);
  scope.moved.thread(threadId);
};
