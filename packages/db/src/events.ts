// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ProviderFailure, ThreadEvent } from "@repo/domain/provider-event";
import { getThreadEventItemRef, threadEventSchema } from "@repo/domain/provider-event";
import { getThreadEventScopeTurnId } from "@repo/domain/thread-event-scope";
import { and, desc, eq, gt, max, sql } from "drizzle-orm";
import type { DbConnection, DbExecutor, DbTransaction } from "./connection";
import { createEventId } from "./ids";
import { readJsonColumn } from "./json-column";
import { events } from "./schema";

export type EventRow = typeof events.$inferSelect;

export interface StoredThreadEvent {
  sequence: number;
  createdAt: number;
  event: ThreadEvent;
}

export interface AppendEventsResult {
  sequences: number[];
}

export interface MissingTurnStartedDetails {
  eventType: ThreadEvent["type"];
  threadId: string;
  turnId: string;
}

export class MissingTurnStartedError extends Error {
  readonly details: MissingTurnStartedDetails;

  constructor(details: MissingTurnStartedDetails) {
    super(
      `Cannot append ${details.eventType} for turn ${details.turnId} before turn/started is stored`,
    );
    this.name = "MissingTurnStartedError";
    this.details = details;
  }
}

const hasStoredTurnStarted = (
  tx: DbTransaction,
  args: { threadId: string; turnId: string },
): boolean =>
  tx
    .select({ id: events.id })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.turnId, args.turnId),
        eq(events.type, "turn/started"),
      ),
    )
    .limit(1)
    .get() !== undefined;

// the high-water read and the inserts share the caller's writeTransaction, whose write lock is
// taken up front, so two writers cannot allocate the same (threadId, sequence); the unique index
// is only the backstop.
export const appendEventsInTransaction = (
  tx: DbTransaction,
  eventInputs: readonly ThreadEvent[],
): AppendEventsResult => {
  if (eventInputs.length === 0) {
    return { sequences: [] };
  }

  const threadIds = [...new Set(eventInputs.map((input) => input.threadId))];
  const nextSequenceByThreadId = new Map<string, number>();
  for (const threadId of threadIds) {
    const row = tx
      .select({ maxSequence: max(events.sequence) })
      .from(events)
      .where(eq(events.threadId, threadId))
      .get();
    nextSequenceByThreadId.set(threadId, (row?.maxSequence ?? 0) + 1);
  }

  // membership only goes false→true inside this immediate transaction (nothing in it deletes an
  // event), so one select per turn answers for every later event in it.
  const startedTurns = new Set<string>();
  // one prepared insert for the batch; building it per row is the cost that scales with a burst.
  const insertEvent = tx
    .insert(events)
    .values({
      createdAt: sql.placeholder("createdAt"),
      data: sql.placeholder("data"),
      id: sql.placeholder("id"),
      itemId: sql.placeholder("itemId"),
      itemKind: sql.placeholder("itemKind"),
      scopeKind: sql.placeholder("scopeKind"),
      sequence: sql.placeholder("sequence"),
      threadId: sql.placeholder("threadId"),
      turnId: sql.placeholder("turnId"),
      type: sql.placeholder("type"),
    })
    .prepare();
  const now = Date.now();
  const sequences: number[] = [];
  for (const input of eventInputs) {
    // the static type pairs each event with its scope but admits an empty turn id; this parse
    // refuses one, and the sql CHECK is only a backstop.
    const event = threadEventSchema.parse(input);
    const turnId = getThreadEventScopeTurnId(event.scope) ?? null;
    if (turnId !== null) {
      const key = `${event.threadId}\u0000${turnId}`;
      if (event.type === "turn/started") {
        startedTurns.add(key);
      } else if (!startedTurns.has(key)) {
        if (!hasStoredTurnStarted(tx, { threadId: event.threadId, turnId })) {
          throw new MissingTurnStartedError({
            eventType: event.type,
            threadId: event.threadId,
            turnId,
          });
        }
        startedTurns.add(key);
      }
    }

    const sequence = nextSequenceByThreadId.get(event.threadId);
    if (sequence === undefined) {
      throw new Error(`Missing event sequence for thread: ${event.threadId}`);
    }
    const itemRef = getThreadEventItemRef(event);
    insertEvent.run({
      createdAt: now,
      data: JSON.stringify(event),
      id: createEventId(),
      itemId: itemRef.itemId,
      itemKind: itemRef.itemKind,
      scopeKind: event.scope.kind,
      sequence,
      threadId: event.threadId,
      turnId,
      type: event.type,
    });

    sequences.push(sequence);
    nextSequenceByThreadId.set(event.threadId, sequence + 1);
  }

  return { sequences };
};

export interface UnreadableStoredEvent {
  sequence: number;
  type: string;
}

export interface ListStoredThreadEventsArgs {
  threadId: string;
  afterSequence?: number;
  // a newer build sharing this data dir can store a type this build's grammar has never seen, and
  // no migration fences it: the row is left out and reported, never thrown for the whole thread.
  onSkipped?: (row: UnreadableStoredEvent) => void;
}

const readStoredEvent = (data: string): ThreadEvent | null =>
  readJsonColumn(data, threadEventSchema);

export const listStoredThreadEvents = (
  db: DbConnection,
  args: ListStoredThreadEventsArgs,
): StoredThreadEvent[] => {
  const rows = db
    .select({
      createdAt: events.createdAt,
      data: events.data,
      sequence: events.sequence,
      type: events.type,
    })
    .from(events)
    .where(
      args.afterSequence === undefined
        ? eq(events.threadId, args.threadId)
        : and(eq(events.threadId, args.threadId), gt(events.sequence, args.afterSequence)),
    )
    .orderBy(events.sequence)
    .all();
  const stored: StoredThreadEvent[] = [];
  for (const row of rows) {
    const event = readStoredEvent(row.data);
    if (event === null) {
      args.onSkipped?.({ sequence: row.sequence, type: row.type });
      continue;
    }
    stored.push({ createdAt: row.createdAt, event, sequence: row.sequence });
  }
  return stored;
};

// the class of the latest error a turn's own rows record, or null when none carries one.
export const storedTurnFailure = (
  db: DbExecutor,
  args: { threadId: string; turnId: string },
): ProviderFailure | null => {
  const row = db
    .select({ data: events.data })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.turnId, args.turnId),
        eq(events.type, "provider/error"),
      ),
    )
    .orderBy(desc(events.sequence))
    .limit(1)
    .get();
  const event = row === undefined ? null : readStoredEvent(row.data);
  return event?.type === "provider/error" ? (event.failure ?? null) : null;
};

export const threadHasEvents = (db: DbExecutor, threadId: string): boolean =>
  db.select({ id: events.id }).from(events).where(eq(events.threadId, threadId)).limit(1).get() !==
  undefined;
