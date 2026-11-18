// A thread's rows: the conversation and the eve session it runs on, its turns and the events its
// record hook keeps (`./eve-agent`), read and written as one account's.

import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { agentThread, agentThreadEvent } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { and, asc, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

export type ThreadRow = typeof agentThread.$inferSelect;

const threadIs = (accountId: string, threadId: string) =>
  and(eq(agentThread.accountId, accountId), eq(agentThread.id, threadId));

export const threadOf = async (
  accountId: string,
  threadId: string,
  executor: DbExecutor = db,
): Promise<ThreadRow | null> => {
  const [row] = await executor.select().from(agentThread).where(threadIs(accountId, threadId));
  return row ?? null;
};

// a thread made by its first message, its eve session not yet created; made again under the same
// id it answers the one there, so a resent first message opens no second thread
export const openThread = async (
  accountId: string,
  thread: { readonly id: string; readonly title: string; readonly now: number },
): Promise<ThreadRow | null> => {
  await db
    .insert(agentThread)
    .values({
      accountId,
      createdAt: thread.now,
      eveSessionNumber: 1,
      id: thread.id,
      status: "idle",
      title: thread.title,
      updatedAt: thread.now,
    })
    .onConflictDoNothing();
  return await threadOf(accountId, thread.id);
};

// the eve session the thread runs on from now, by its number
export const startedSession = async (
  executor: DbExecutor,
  row: ThreadRow,
  session: { readonly number: number; readonly id: string; readonly now: number },
): Promise<ThreadRow | null> => {
  const [updated] = await executor
    .update(agentThread)
    .set({
      eveSessionId: session.id,
      eveSessionNumber: session.number,
      eveSessionStartedAt: session.now,
      updatedAt: session.now,
    })
    .where(threadIs(row.accountId, row.id))
    .returning();
  return updated ?? null;
};

// the thread, its events and its turns gone at once; its eve session is ended beside it
export const deleteThread = async (
  accountId: string,
  threadId: string,
): Promise<ThreadRow | null> => {
  const [deleted] = await db.delete(agentThread).where(threadIs(accountId, threadId)).returning();
  return deleted ?? null;
};

type ThreadListed = z.infer<typeof threadRowSchema>;

const listed = (row: ThreadRow): ThreadListed => ({
  createdAt: row.createdAt,
  id: row.id,
  status: row.status,
  title: row.title,
  updatedAt: row.updatedAt,
});

// the account's threads, most recently moved first, a page from `cursor`
export const listThreads = async (
  accountId: string,
  page: { readonly cursor: number; readonly limit: number },
): Promise<{ cursor: number | null; threads: ThreadListed[] }> => {
  const rows = await db
    .select()
    .from(agentThread)
    .where(eq(agentThread.accountId, accountId))
    .orderBy(desc(agentThread.updatedAt), asc(agentThread.id))
    .offset(page.cursor)
    .limit(page.limit + 1);
  const shown = rows.slice(0, page.limit);
  return {
    cursor: rows.length > page.limit ? page.cursor + shown.length : null,
    threads: shown.map(listed),
  };
};

// a thread event's id: where eve recorded the fact it shows
const threadEventId = (at: {
  readonly eveSessionNumber: number;
  readonly line: number;
  readonly index: number;
}): string => `${String(at.eveSessionNumber)}:${String(at.line)}:${String(at.index)}`;

// what jsonb hands back, read as the JSON the row's schema carries
const storedEvent = z.json();

// the thread's events after `after`, in the order they were recorded
export const threadEvents = async (
  accountId: string,
  page: { readonly threadId: string; readonly after?: number | undefined; readonly limit: number },
): Promise<{ events: z.infer<typeof threadEventRowSchema>[]; more: boolean }> => {
  const rows = await db
    .select()
    .from(agentThreadEvent)
    .where(
      and(
        eq(agentThreadEvent.accountId, accountId),
        eq(agentThreadEvent.threadId, page.threadId),
        page.after === undefined ? undefined : gt(agentThreadEvent.idx, page.after),
      ),
    )
    .orderBy(asc(agentThreadEvent.idx))
    .limit(page.limit + 1);
  return {
    events: rows.slice(0, page.limit).map((row) => ({
      at: row.at,
      event: storedEvent.parse(row.event),
      eventId: threadEventId(row),
      idx: row.idx,
      threadId: row.threadId,
      type: row.type,
    })),
    more: rows.length > page.limit,
  };
};
