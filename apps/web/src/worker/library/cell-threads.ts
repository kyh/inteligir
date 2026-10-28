// The account's conversations with the built-in agent, as the cell keeps them: a thread row and
// the final events of its turns, synced to every device like the library's other rows. Listing and
// paging read them; deleting a thread removes its rows and logs each as gone, so every replica
// drops them too.

import { recordChanges } from "@repo/notes/library/library-queries";
import { runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { LandingScope } from "./cell-landing";
import { offsetOf } from "./cell-reads";
import { refuse } from "./cell-refusal";
import {
  THREAD_COLUMNS,
  THREAD_EVENT_COLUMNS,
  threadEventRowFrom,
  threadRowFrom,
} from "./cell-sync";

const idRowSchema = z.object({ event_id: z.string() });

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

// the thread and every event it stored, each logged as gone
export const deleteThread = (scope: LandingScope, threadId: string): void => {
  const { storage } = scope;
  if (!threadExists(storage, threadId)) {
    refuse({ kind: "not-found" });
  }
  const seq = scope.seq();
  const events = storage
    .all("SELECT event_id FROM thread_events WHERE thread_id = ?", [threadId])
    .map((row) => idRowSchema.parse(row).event_id);
  storage.run("DELETE FROM thread_events WHERE thread_id = ?", [threadId]);
  storage.run("DELETE FROM threads WHERE id = ?", [threadId]);
  runPlan(
    storage,
    recordChanges([
      { gone: true, id: threadId, kind: "thread", seq },
      ...events.map((id) => ({ gone: true, id, kind: "thread_event" as const, seq })),
    ]),
  );
};
