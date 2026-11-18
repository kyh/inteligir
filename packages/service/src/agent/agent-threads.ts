import type { threadEventRowSchema, threadRowSchema } from "@repo/contract/library/library-wire";
import { agentThread, agentThreadEvent, agentTurn } from "@repo/db/agent-schema";
import { db } from "@repo/db/drizzle-client";
import type { DbExecutor, Tx } from "@repo/db/drizzle-client";
import { and, asc, desc, eq, gt, isNotNull, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";

import { takeLibraryHead } from "../library/library-store";
import type { TurnStop } from "./agent-limits";
import type { ThreadPosition } from "./thread-events";
import { cursorOf } from "./thread-events";

export type ThreadRow = typeof agentThread.$inferSelect;

const liveThreadIs = (accountId: string, threadId: string) =>
  and(
    eq(agentThread.accountId, accountId),
    eq(agentThread.id, threadId),
    isNull(agentThread.deletedAt),
  );

export const threadOf = async (accountId: string, threadId: string, executor: DbExecutor = db) => {
  const [row] = await executor.select().from(agentThread).where(liveThreadIs(accountId, threadId));

  return row ?? null;
};

export const openThread = async (
  accountId: string,
  thread: { readonly id: string; readonly title: string; readonly now: number },
) => {
  await db.transaction(async (tx) => {
    const seq = await takeLibraryHead(tx, accountId);
    await tx
      .insert(agentThread)
      .values({
        accountId,
        createdAt: thread.now,
        eveSessionNumber: 1,
        id: thread.id,
        seq,
        status: "idle",
        title: thread.title,
        updatedAt: thread.now,
      })
      .onConflictDoNothing();
  });

  return await threadOf(accountId, thread.id);
};

type ThreadMove = Partial<Pick<ThreadRow, "deletedAt" | "status" | "updatedAt">>;

export const moveThread = async (tx: Tx, accountId: string, threadId: string, move: ThreadMove) => {
  const seq = await takeLibraryHead(tx, accountId);

  const [moved] = await tx
    .update(agentThread)
    .set({ ...move, seq })
    .where(liveThreadIs(accountId, threadId))
    .returning();

  return moved ?? null;
};

export const startedSession = async (
  executor: DbExecutor,
  row: ThreadRow,
  session: { readonly number: number; readonly id: string; readonly now: number },
) => {
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

export const retireThread = async (accountId: string, threadId: string, now: number) =>
  await db.transaction(async (tx) => await moveThread(tx, accountId, threadId, { deletedAt: now }));

export const retiredThreads = async (limit: number) =>
  await db
    .select()
    .from(agentThread)
    .where(isNotNull(agentThread.deletedAt))
    .orderBy(sql`${agentThread.purgeTriedAt} asc nulls first`, asc(agentThread.deletedAt))
    .limit(limit);

export const purgeTried = async (row: ThreadRow, now: number) => {
  await db
    .update(agentThread)
    .set({ purgeTriedAt: now })
    .where(
      and(
        eq(agentThread.accountId, row.accountId),
        eq(agentThread.id, row.id),
        isNotNull(agentThread.deletedAt),
      ),
    );
};

export const purgeThreadRow = async (row: ThreadRow) => {
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

const listed = (row: ThreadRow) =>
  ({
    createdAt: row.createdAt,
    id: row.id,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt,
  }) satisfies ThreadListed;

export const listThreads = async (
  accountId: string,
  page: { readonly cursor: number; readonly limit: number },
) => {
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
  } satisfies { cursor: number | null; threads: ThreadListed[] };
};

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

export const keepTurn = async (executor: DbExecutor, at: TurnAt, now: number) => {
  await executor
    .insert(agentTurn)
    .values({
      ...at,
      number: sql`(select coalesce(max(${agentTurn.number}), 0) + 1 from ${agentTurn} where ${agentTurn.accountId} = ${at.accountId} and ${agentTurn.threadId} = ${at.threadId})`,
      startedAt: now,
    })
    .onConflictDoNothing({
      target: [
        agentTurn.accountId,
        agentTurn.threadId,
        agentTurn.eveSessionNumber,
        agentTurn.eveTurnId,
      ],
    });
};

export interface KeptTurn {
  readonly number: number;
  readonly stopReason: TurnStop | null;
  readonly settledAt: number | null;
}

export const turnOf = async (executor: DbExecutor, at: TurnAt) => {
  const [row] = await executor
    .select({
      number: agentTurn.number,
      settledAt: agentTurn.settledAt,
      stopReason: agentTurn.stopReason,
    })
    .from(agentTurn)
    .where(turnIs(at));

  return row ?? null;
};

export const stampTurnStop = async (executor: DbExecutor, at: TurnAt, stop: TurnStop) => {
  await executor
    .update(agentTurn)
    .set({ stopReason: stop })
    .where(and(turnIs(at), isNull(agentTurn.stopReason)));
};

export type ThreadEventRow = z.infer<typeof threadEventRowSchema>;

const storedEvent = z.json();

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

interface KeptEvent {
  readonly position: ThreadPosition;
  readonly row: ThreadEventRow;
}

const keptOf = (row: typeof agentThreadEvent.$inferSelect) => {
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
  } satisfies KeptEvent;
};

export const keptEventAt = async (
  accountId: string,
  threadId: string,
  { index, line, session }: ThreadPosition,
) => {
  const [row] = await db
    .select()
    .from(agentThreadEvent)
    .where(
      and(
        eq(agentThreadEvent.accountId, accountId),
        eq(agentThreadEvent.threadId, threadId),
        eq(agentThreadEvent.eveSessionNumber, session),
        eq(agentThreadEvent.line, line),
        eq(agentThreadEvent.index, index),
      ),
    );

  return row === undefined ? null : keptOf(row).row;
};

export const threadHistory = async (
  accountId: string,
  page: {
    readonly threadId: string;
    readonly after: ThreadPosition | null;
    readonly limit: number;
  },
) => {
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

  return rows.map(keptOf);
};
