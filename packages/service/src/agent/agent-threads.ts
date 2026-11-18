// A thread's rows: the conversation and the eve session it runs on, its turns and the events its
// record hook keeps (`./eve-agent`), read and written as one account's. A deleted thread is read by
// nothing here but its retirement (`./agent-sessions`).

import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { and, asc, desc, eq, gt, isNotNull, isNull, or } from "drizzle-orm";
import { z } from "zod";

import type { ThreadPosition } from "./thread-events";
import { cursorOf } from "./thread-events";

export type ThreadRow = typeof agentThread.$inferSelect;

const liveThreadIs = (accountId: string, threadId: string) =>
  and(
    eq(agentThread.accountId, accountId),
    eq(agentThread.id, threadId),
    isNull(agentThread.deletedAt),
  );

export const threadOf = async (
  accountId: string,
  threadId: string,
  executor: DbExecutor = db,
): Promise<ThreadRow | null> => {
  const [row] = await executor.select().from(agentThread).where(liveThreadIs(accountId, threadId));
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

// the eve session the thread runs on from now, by its number; null once the thread was deleted
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
    .where(liveThreadIs(row.accountId, row.id))
    .returning();
  return updated ?? null;
};

// a deleted thread, from now read only by its retirement, which ends its eve session
export const retireThread = async (
  accountId: string,
  threadId: string,
  now: number,
): Promise<ThreadRow | null> => {
  const [retired] = await db
    .update(agentThread)
    .set({ deletedAt: now })
    .where(liveThreadIs(accountId, threadId))
    .returning();
  return retired ?? null;
};

// the deleted threads whose eve session is still to end, the longest deleted first
export const retiredThreads = async (limit: number): Promise<ThreadRow[]> =>
  await db
    .select()
    .from(agentThread)
    .where(isNotNull(agentThread.deletedAt))
    .orderBy(asc(agentThread.deletedAt))
    .limit(limit);

// a deleted thread gone, its events and its turns with it
export const purgeThreadRow = async (row: ThreadRow): Promise<void> => {
  await db
    .delete(agentThread)
    .where(
      and(
        eq(agentThread.accountId, row.accountId),
        eq(agentThread.id, row.id),
        isNotNull(agentThread.deletedAt),
      ),
    );
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
    .where(and(eq(agentThread.accountId, accountId), isNull(agentThread.deletedAt)))
    .orderBy(desc(agentThread.updatedAt), asc(agentThread.id))
    .offset(page.cursor)
    .limit(page.limit + 1);
  const shown = rows.slice(0, page.limit);
  return {
    cursor: rows.length > page.limit ? page.cursor + shown.length : null,
    threads: shown.map(listed),
  };
};

// a turn by where eve started it: eve numbers turns within a session alone
export interface TurnAt {
  readonly accountId: string;
  readonly threadId: string;
  readonly eveSessionNumber: number;
  readonly eveTurnId: string;
}

export const turnIs = (at: TurnAt) =>
  and(
    eq(agentTurn.accountId, at.accountId),
    eq(agentTurn.threadId, at.threadId),
    eq(agentTurn.eveSessionNumber, at.eveSessionNumber),
    eq(agentTurn.eveTurnId, at.eveTurnId),
  );

// the turn's number in its thread, or null for a turn whose start was never kept
export const turnNumberOf = async (executor: DbExecutor, at: TurnAt): Promise<number | null> => {
  const [row] = await executor
    .select({ number: agentTurn.number })
    .from(agentTurn)
    .where(turnIs(at));
  return row?.number ?? null;
};

export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

// what jsonb hands back, read as the JSON the row's schema carries
const storedEvent = z.json();

// recorded after `after`: its session's later places, then every later session's
const recordedAfter = ({ index, line, session }: ThreadPosition) =>
  or(
    gt(agentThreadEvent.eveSessionNumber, session),
    and(eq(agentThreadEvent.eveSessionNumber, session), gt(agentThreadEvent.line, line)),
    and(
      eq(agentThreadEvent.eveSessionNumber, session),
      eq(agentThreadEvent.line, line),
      gt(agentThreadEvent.index, index),
    ),
  );

export interface KeptEvent {
  readonly position: ThreadPosition;
  readonly row: ThreadEventRow;
}

// a page of the thread's kept events after `after`, in the order eve recorded them
export const threadHistory = async (
  accountId: string,
  page: {
    readonly threadId: string;
    readonly after: ThreadPosition | null;
    readonly limit: number;
  },
): Promise<KeptEvent[]> => {
  const rows = await db
    .select()
    .from(agentThreadEvent)
    .where(
      and(
        eq(agentThreadEvent.accountId, accountId),
        eq(agentThreadEvent.threadId, page.threadId),
        page.after === null ? undefined : recordedAfter(page.after),
      ),
    )
    .orderBy(
      asc(agentThreadEvent.eveSessionNumber),
      asc(agentThreadEvent.line),
      asc(agentThreadEvent.index),
    )
    .limit(page.limit);
  return rows.map((row) => {
    const position = { index: row.index, line: row.line, session: row.eveSessionNumber };
    return {
      position,
      row: {
        at: row.at,
        event: storedEvent.parse(row.event),
        eventId: cursorOf(position),
        threadId: row.threadId,
        type: row.type,
      },
    };
  });
};
