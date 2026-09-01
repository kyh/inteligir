import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import type { ThreadEventItemType, ThreadEventType } from "@repo/domain/provider-event";
import type { ThreadEventScopeKind } from "@repo/domain/thread-event-scope";
import { threadStatusValues } from "@repo/domain/thread-status";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

/**
 * Database-level facts, one row per key. `schema_version` is seeded by the
 * first migration and bumped by later ones, so it always states which
 * migration generation the file is on.
 */
export const meta = sqliteTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export const threads = sqliteTable(
  "threads",
  {
    id: text("id").primaryKey(),
    title: text("title"),
    status: text("status", { enum: threadStatusValues }).notNull().default("idle"),
    // The turn the current status describes: bound by run.started, unbound by
    // every settle. The lifecycle CAS matches settles against it so a late
    // completion for an old turn cannot settle the running one.
    activeTurnId: text("active_turn_id"),
    // The vault doc this thread is ABOUT: an action attaches to the note it
    // was composed over.
    originDocPath: text("origin_doc_path"),
    // The provider session this thread resumes into: which
    // provider ran it and the provider's own thread id. Written together by
    // the one writer (setThreadProviderSession) once the runtime resolves the
    // session; no CHECK pairs them because SQLite cannot ADD a checked column
    // without rebuilding the table, and a rebuild would cascade through the
    // children's foreign keys mid-migration. Survives process restarts and
    // idle-session reaping — the next turn resumes by this id.
    providerId: text("provider_id"),
    providerThreadId: text("provider_thread_id"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    // The list query is two indexed scans (live, then archived), each ordered
    // by its own partial index — one combined (archived_at, updated_at) index
    // cannot serve `archived_at IS NOT NULL … ORDER BY updated_at` without a
    // temp b-tree, because IS NOT NULL is a range over the leading column.
    index("threads_live_updated_idx")
      .on(table.updatedAt)
      .where(sql`${table.archivedAt} IS NULL`),
    index("threads_archived_updated_idx")
      .on(table.updatedAt)
      .where(sql`${table.archivedAt} IS NOT NULL`),
    // A rename rebinds every thread bound to the moved doc by this key
    // (rebindThreadOrigins' equality UPDATE); the descendant sweep beside it
    // is a prefix LIKE, which no index can serve.
    index("threads_origin_doc_idx").on(table.originDocPath),
  ],
);

// Vendored from bb (github.com/get-bb/bb), MIT. © bb contributors.
export const events = sqliteTable(
  "events",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    scopeKind: text("scope_kind").$type<ThreadEventScopeKind>().notNull(),
    turnId: text("turn_id"),
    // Server-assigned, contiguous per thread; the append path allocates it
    // from the transaction's own high-water read.
    sequence: integer("sequence").notNull(),
    type: text("type").$type<ThreadEventType>().notNull(),
    itemId: text("item_id"),
    itemKind: text("item_kind").$type<ThreadEventItemType>(),
    data: text("data").notNull().default("{}"),
    // WHOSE outbox position this row arrived as: the writing
    // device and that device's own counter, server-stamped on the merged log
    // row. Both null for an event THIS process produced.
    //
    // It is the log row's natural key, and the reason it is stored rather than
    // the account-global `seq` is re-pairing: a global seq means a different
    // row under a different account, so an idempotency check keyed on it would
    // wrongly SKIP a genuine event, while a (device, position) pair is minted
    // per pairing and never reused. Two things read it — the apply, which is
    // idempotent on it, and crash recovery, which must not fail a turn whose
    // provider belongs to another machine.
    //
    // No CHECK pairs them: SQLite cannot ADD a checked column without
    // rebuilding the table, and a rebuild would cascade through the children's
    // foreign keys mid-migration. One writer sets both or neither.
    originDeviceId: text("origin_device_id"),
    originDeviceSeq: integer("origin_device_seq"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_thread_sequence_idx").on(table.threadId, table.sequence),
    // The apply's idempotency, with teeth: a replayed log row cannot become a
    // second event even if the pre-check ever misses it. SQLite treats NULLs as
    // DISTINCT in a unique index, so every locally-written row (both columns
    // null) coexists freely.
    uniqueIndex("events_origin_idx").on(table.originDeviceId, table.originDeviceSeq),
    // Open-turn resolution and lifecycle lookups scan by (thread, type) —
    // latest turn/started, matching turn/completed — without touching data.
    index("events_thread_type_sequence_idx").on(table.threadId, table.type, table.sequence),
    // Turn windows and per-item folds (deltas onto their item/started row)
    // narrow by turn and item before ordering by sequence.
    index("events_thread_turn_type_item_sequence_idx").on(
      table.threadId,
      table.turnId,
      table.type,
      table.itemId,
      table.sequence,
    ),
    // The db-side half of the scope rule the zod grammar enforces at parse:
    // a turn-scoped row without its turn id (or the reverse) cannot exist.
    check(
      "events_scope_shape_check",
      sql`(
        (${table.scopeKind} = 'turn' AND ${table.turnId} IS NOT NULL)
        OR
        (${table.scopeKind} = 'thread' AND ${table.turnId} IS NULL)
      )`,
    ),
  ],
);

export const queuedThreadMessages = sqliteTable(
  "queued_thread_messages",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    // Claim is a CAS pair: both null while queued, both set while a drain
    // holds the message. A claim that dies is released by nulling them.
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    sortKey: text("sort_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    // Drain order: next unclaimed message by sort key, id as tiebreak.
    index("queued_thread_messages_thread_sort_idx").on(table.threadId, table.sortKey, table.id),
  ],
);

export const pendingInteractions = sqliteTable(
  "pending_interactions",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    turnId: text("turn_id"),
    // The provider's own request identity: a retried/replayed request upserts
    // into its existing row instead of raising a second prompt.
    requestKey: text("request_key").notNull(),
    status: text("status", { enum: pendingInteractionStatusValues }).notNull(),
    payload: text("payload").notNull(),
    resolution: text("resolution"),
    createdAt: integer("created_at").notNull(),
    resolvedAt: integer("resolved_at"),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    uniqueIndex("pending_interactions_thread_request_idx").on(table.threadId, table.requestKey),
    // The thread-detail read lists open interactions oldest-first.
    index("pending_interactions_thread_status_created_idx").on(
      table.threadId,
      table.status,
      table.createdAt,
    ),
  ],
);

/**
 * The cloud sync outbox: one row per LOCAL thread event still owed to the
 * account's merged log (`@repo/api/cloud/sync/sync-schema`).
 *
 * `device_seq` is the WIRE position — strictly increasing per device across
 * batches, and the log's idempotency key. It cannot be derived from
 * `events.sequence`, which is contiguous per THREAD and so orders nothing
 * about a device; and it cannot be read back as `MAX(device_seq)` here,
 * because a pushed row is deleted and a counter over a shrinking table would
 * hand a later event a position the log already holds. Its high-water lives in
 * `sync_state` instead.
 *
 * `body` is the event's serialized bytes, FROZEN at enqueue. Re-pushing a
 * stored position is the retry path only while the bytes match, so deriving
 * them again at push time — from a later build's grammar, or a key order that
 * moved — is `sync-conflict` rather than idempotency.
 *
 * No foreign key to `threads`: the row is a wire payload already computed, not
 * thread state, and a cascade would silently drop a position the log's
 * high-water has passed.
 */
export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    id: text("id").primaryKey(),
    deviceSeq: integer("device_seq").notNull(),
    threadId: text("thread_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    // The drain reads and the ack deletes in this order, and a position may
    // never be enqueued twice.
    uniqueIndex("sync_outbox_device_seq_idx").on(table.deviceSeq),
  ],
);

/**
 * This device's sync position, in ONE row: the outbox counter's high-water and
 * the account log's global `seq` applied through. Both survive an unpair only
 * by being reset together — a cursor kept across accounts would skip another
 * account's log from its own first row.
 */
export const syncState = sqliteTable(
  "sync_state",
  {
    id: integer("id").primaryKey(),
    lastDeviceSeq: integer("last_device_seq").notNull().default(0),
    cursor: integer("cursor").notNull().default(0),
    lastSyncedAt: integer("last_synced_at"),
  },
  (table) => [check("sync_state_singleton_check", sql`${table.id} = 1`)],
);

/**
 * Capture ids this device has already written into the vault. The inbox's
 * guarantee is at-least-once DELIVERY with exactly-once deletion by the owning
 * claim, so a device that applied and then lost its claim is handed the same
 * capture again — this table is what makes the second apply a no-op.
 *
 * Rows are pruned by age rather than kept: once a capture is acked by its
 * owner it leaves the inbox and can never be delivered again, so the only
 * window this covers is a lapsed claim.
 */
export const syncAppliedCaptures = sqliteTable("sync_applied_captures", {
  id: text("id").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});
