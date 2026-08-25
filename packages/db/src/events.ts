// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.

import type { ThreadEvent } from "@repo/domain/provider-event";
import { getThreadEventItemRef, threadEventSchema } from "@repo/domain/provider-event";
import { getThreadEventScopeTurnId } from "@repo/domain/thread-event-scope";
import { and, eq, gt, inArray, max, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "./connection";
import { createEventId } from "./ids";
import type { DbNotifier } from "@repo/domain/notifier";
import { events } from "./schema";

export type EventRow = typeof events.$inferSelect;

/** A stored event read back for projection: the parsed grammar plus the
 *  server-assigned metadata the projection orders and keys rows by. */
export interface StoredThreadEvent {
  sequence: number;
  createdAt: number;
  event: ThreadEvent;
}

export interface AppendEventsResult {
  /** Server-assigned sequences, in input order. */
  sequences: number[];
}

export interface AppendSyncedEventsResult extends AppendEventsResult {
  /**
   * The rows that actually LANDED — the input minus whatever this database
   * already held.
   *
   * The caller needs this and not just a count, because lifecycle projection
   * has to run over exactly these: replaying a `turn/started` whose
   * `turn/completed` fell on the far side of a page boundary would leave the
   * thread active for a turn that finished long ago.
   */
  applied: readonly SyncedEventInput[];
}

export interface MissingTurnStartedDetails {
  eventType: ThreadEvent["type"];
  threadId: string;
  turnId: string;
}

/** A turn-content event arrived before its turn/started was stored — an
 *  ordering bug in the producer, refused so the log stays projectable. */
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

function hasStoredTurnStarted(
  tx: DbTransaction,
  args: { threadId: string; turnId: string },
): boolean {
  return (
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
      .get() !== undefined
  );
}

/**
 * Which device's outbox position a synced event arrived as — the merged log
 * row's natural key (`@repo/api/cloud/sync/sync-schema`), and the identity the apply
 * is idempotent on.
 */
export interface SyncedEventOrigin {
  deviceId: string;
  deviceSeq: number;
}

export interface SyncedEventInput {
  event: ThreadEvent;
  origin: SyncedEventOrigin;
}

interface AppendInput {
  event: ThreadEvent;
  /** null for an event THIS process produced. */
  origin: SyncedEventOrigin | null;
}

/**
 * Which of `origins` this database already holds. One query per writing
 * device, so a page of the merged log costs a handful of statements rather
 * than one per row.
 */
function storedOrigins(tx: DbTransaction, origins: readonly SyncedEventOrigin[]): Set<string> {
  const byDevice = new Map<string, number[]>();
  for (const origin of origins) {
    const positions = byDevice.get(origin.deviceId) ?? [];
    positions.push(origin.deviceSeq);
    byDevice.set(origin.deviceId, positions);
  }
  const stored = new Set<string>();
  for (const [deviceId, positions] of byDevice) {
    const rows = tx
      .select({ deviceSeq: events.originDeviceSeq })
      .from(events)
      .where(and(eq(events.originDeviceId, deviceId), inArray(events.originDeviceSeq, positions)))
      .all();
    for (const row of rows) {
      if (row.deviceSeq !== null) {
        stored.add(originKey(deviceId, row.deviceSeq));
      }
    }
  }
  return stored;
}

function originKey(deviceId: string, deviceSeq: number): string {
  return `${deviceId} ${deviceSeq}`;
}

/**
 * Events THIS process produced. The common door, and the reason it takes bare
 * events: a locally-written row has no origin to carry, and a signature that
 * asked for one would invite every call site to invent a value for it.
 */
export function appendEventsInTransaction(
  tx: DbTransaction,
  eventInputs: readonly ThreadEvent[],
): AppendEventsResult {
  return appendInTransaction(
    tx,
    eventInputs.map((event) => ({ event, origin: null })),
  );
}

/**
 * Events another device wrote, arriving through the account's merged log.
 *
 * The SAME append — one body, two doors — with the one thing a replayed log
 * row needs: a row whose (device, position) is already stored is SKIPPED, so
 * re-pairing (which resets the cursor to the log's beginning) replays the
 * account's history into no new rows at all. Without it the second pairing
 * duplicates every event the first one applied.
 */
export function appendSyncedEventsInTransaction(
  tx: DbTransaction,
  inputs: readonly SyncedEventInput[],
): AppendSyncedEventsResult {
  if (inputs.length === 0) {
    return { sequences: [], applied: [] };
  }
  const stored = storedOrigins(
    tx,
    inputs.map((input) => input.origin),
  );
  const applied = inputs.filter(
    (input) => !stored.has(originKey(input.origin.deviceId, input.origin.deviceSeq)),
  );
  return { ...appendInTransaction(tx, applied), applied };
}

function appendInTransaction(
  tx: DbTransaction,
  eventInputs: readonly AppendInput[],
): AppendEventsResult {
  if (eventInputs.length === 0) {
    return { sequences: [] };
  }

  const threadIds = [...new Set(eventInputs.map((input) => input.event.threadId))];
  const nextSequenceByThreadId = new Map<string, number>();
  for (const threadId of threadIds) {
    const row = tx
      .select({ maxSequence: max(events.sequence) })
      .from(events)
      .where(eq(events.threadId, threadId))
      .get();
    nextSequenceByThreadId.set(threadId, (row?.maxSequence ?? 0) + 1);
  }

  // Turns known to have a stored `turn/started`, whether this batch wrote it or
  // an earlier one did. The membership can only ever go false→true inside this
  // immediate transaction (nothing deletes an event), so the answer the SELECT
  // gives for a turn is the answer for every later event in the same turn —
  // and a streaming turn is a long run of events that all name it.
  const startedTurns = new Set<string>();
  // One statement for the whole batch. The coalescer hands this a burst of
  // deltas at a time, and building the same INSERT per row is the cost that
  // scales with the burst.
  const insertEvent = tx
    .insert(events)
    .values({
      id: sql.placeholder("id"),
      threadId: sql.placeholder("threadId"),
      scopeKind: sql.placeholder("scopeKind"),
      turnId: sql.placeholder("turnId"),
      sequence: sql.placeholder("sequence"),
      type: sql.placeholder("type"),
      itemId: sql.placeholder("itemId"),
      itemKind: sql.placeholder("itemKind"),
      originDeviceId: sql.placeholder("originDeviceId"),
      originDeviceSeq: sql.placeholder("originDeviceSeq"),
      // The full event JSON, columns derived from it below — one schema to
      // parse back, no payload-reassembly layer, and the columns cannot
      // disagree with the data because this is their only writer.
      data: sql.placeholder("data"),
      createdAt: sql.placeholder("createdAt"),
    })
    .prepare();
  const now = Date.now();
  const sequences: number[] = [];
  for (const input of eventInputs) {
    // Parse at the WRITE, not only at the boundary: the static type admits
    // any (event, scope) pairing, so the scope policy is enforced here and
    // the SQL CHECK below stays a shape backstop, never the first defense.
    const event = threadEventSchema.parse(input.event);
    const turnId = getThreadEventScopeTurnId(event.scope) ?? null;
    if (turnId !== null) {
      const key = `${event.threadId} ${turnId}`;
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
      id: createEventId(),
      threadId: event.threadId,
      scopeKind: event.scope.kind,
      turnId,
      sequence,
      type: event.type,
      itemId: itemRef.itemId,
      itemKind: itemRef.itemKind,
      originDeviceId: input.origin?.deviceId ?? null,
      originDeviceSeq: input.origin?.deviceSeq ?? null,
      data: JSON.stringify(event),
      createdAt: now,
    });

    sequences.push(sequence);
    nextSequenceByThreadId.set(event.threadId, sequence + 1);
  }

  return { sequences };
}

/**
 * Append validated events with server-assigned, per-thread-contiguous
 * sequences: the high-water read and every insert share one immediate
 * transaction, so two writers can never allocate the same (threadId,
 * sequence) — the UNIQUE index is the backstop, not the mechanism.
 */
export function appendEvents(
  db: DbConnection,
  notifier: DbNotifier,
  eventInputs: readonly ThreadEvent[],
): AppendEventsResult {
  const result = db.transaction((tx) => appendEventsInTransaction(tx, eventInputs), {
    behavior: "immediate",
  });
  for (const threadId of new Set(eventInputs.map((event) => event.threadId))) {
    notifier.notifyThread(threadId, ["events-appended"]);
  }
  return result;
}

export interface ListStoredThreadEventsArgs {
  threadId: string;
  afterSequence?: number;
}

export function listStoredThreadEvents(
  db: DbConnection,
  args: ListStoredThreadEventsArgs,
): StoredThreadEvent[] {
  const rows = db
    .select({ sequence: events.sequence, createdAt: events.createdAt, data: events.data })
    .from(events)
    .where(
      args.afterSequence === undefined
        ? eq(events.threadId, args.threadId)
        : and(eq(events.threadId, args.threadId), gt(events.sequence, args.afterSequence)),
    )
    .orderBy(events.sequence)
    .all();
  return rows.map((row) => ({
    sequence: row.sequence,
    createdAt: row.createdAt,
    event: threadEventSchema.parse(JSON.parse(row.data)),
  }));
}

/**
 * The device that started `turnId`, or null when THIS process did — read off
 * the `turn/started` row's own provenance.
 *
 * Crash recovery is the caller, and the question it has to answer is "is the
 * provider behind this turn mine to declare dead?". Only the process that owns
 * a provider can say so: a turn pulled from another device is running
 * elsewhere, and failing it here would push a fabricated failure back to the
 * machine where the work is genuinely still going.
 */
export function turnStartOriginDeviceId(
  db: DbConnection,
  args: { threadId: string; turnId: string },
): string | null {
  const row = db
    .select({ deviceId: events.originDeviceId })
    .from(events)
    .where(
      and(
        eq(events.threadId, args.threadId),
        eq(events.turnId, args.turnId),
        eq(events.type, "turn/started"),
      ),
    )
    .limit(1)
    .get();
  return row?.deviceId ?? null;
}

export function getMaxSequence(db: DbConnection, threadId: string): number {
  const row = db
    .select({ maxSequence: max(events.sequence) })
    .from(events)
    .where(eq(events.threadId, threadId))
    .get();
  return row?.maxSequence ?? 0;
}
