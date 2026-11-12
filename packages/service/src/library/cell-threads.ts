// The account's conversations with the built-in agent, as the cell keeps them: a thread row and
// the final events of its turns. Listing and paging read them; deleting a thread removes its rows.

import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { THREAD_STATUSES } from "@repo/contract/library/library-wire";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { threadEvents as threadEventRows, threads } from "@repo/db/cell/schema";
import { jsonTextSchema } from "./sql-value";
import type { CellDb } from "./cell-db";
import type { LandingScope } from "./cell-landing";
import { offsetOf } from "./cell-reads";
import { refuse } from "./cell-refusal";

type ThreadRow = z.infer<typeof threadRowSchema>;
type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const statusSchema = z.enum(THREAD_STATUSES);

const threadExists = (db: CellDb, threadId: string): boolean =>
  db.select({ id: threads.id }).from(threads).where(eq(threads.id, threadId)).get() !== undefined;

// the newest-touched first
export const listThreads = (
  db: CellDb,
  input: { readonly cursor?: string | undefined; readonly limit: number },
) => {
  const offset = offsetOf(input.cursor);
  const rows = db
    .select()
    .from(threads)
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(input.limit + 1)
    .offset(offset)
    .all()
    .map((row): ThreadRow => ({ ...row, status: statusSchema.parse(row.status) }));
  return {
    cursor: rows.length > input.limit ? String(offset + input.limit) : null,
    threads: rows.slice(0, input.limit),
  };
};

// a thread's stored events after position `after`, in order
export const threadEvents = (
  db: CellDb,
  input: { readonly threadId: string; readonly after?: number | undefined; readonly limit: number },
) => {
  if (!threadExists(db, input.threadId)) {
    return refuse({ kind: "not-found" });
  }
  const rows = db
    .select()
    .from(threadEventRows)
    .where(
      and(eq(threadEventRows.threadId, input.threadId), gt(threadEventRows.idx, input.after ?? -1)),
    )
    .orderBy(asc(threadEventRows.idx))
    .limit(input.limit + 1)
    .all()
    .map(({ json, ...row }): ThreadEventRow => ({ ...row, event: jsonTextSchema.parse(json) }));
  return { events: rows.slice(0, input.limit), more: rows.length > input.limit };
};

// the thread and every event it stored
export const deleteThread = (scope: LandingScope, threadId: string): void => {
  const { db } = scope.storage;
  if (!threadExists(db, threadId)) {
    refuse({ kind: "not-found" });
  }
  db.delete(threadEventRows).where(eq(threadEventRows.threadId, threadId)).run();
  db.delete(threads).where(eq(threads.id, threadId)).run();
  scope.moved.thread(threadId);
};
