import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import type { ThreadEventItemType, ThreadEventType } from "@repo/domain/provider-event";
import type { ThreadEventScopeKind } from "@repo/domain/thread-event-scope";
import { threadStatusValues } from "@repo/domain/thread-status";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// schema_version is seeded by the first migration and bumped by every later one.
/* oxlint-disable sort-keys -- a table's column order is the CREATE TABLE order drizzle-kit
   emits; sorting it makes the next generated migration recreate every table. */
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
    // the lifecycle cas matches settles against it, so a late completion for an old turn cannot
    // settle the running one.
    activeTurnId: text("active_turn_id"),
    originDocPath: text("origin_doc_path"),
    // no CHECK pairs them: sqlite cannot ADD a checked column without rebuilding the table, and
    // a rebuild cascades through the children's foreign keys mid-migration.
    providerId: text("provider_id"),
    providerThreadId: text("provider_thread_id"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    // the origin note's frontmatter `id`, which a move anywhere (Finder, a pull, an agent's `mv`)
    // keeps; origin_doc_path stays the path at compose time and answers for a note with none. no
    // index: the listing filters by it (and by origin_doc_path) inside the (updated_at, id)
    // partial-index scan, which a vault's thread count keeps cheap.
    originNoteId: text("origin_note_id"),
  },
  (table) => [
    // two partial indexes: one (archived_at, updated_at) index cannot serve
    // `IS NOT NULL … ORDER BY updated_at` without a temp b-tree, since IS NOT NULL is a range
    // over the leading column. `id` is the listing's tie-break, so a page cursor's
    // `(updated_at, id) <` seeks the index rather than sorting a millisecond's ties.
    index("threads_live_updated_id_idx")
      .on(table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NULL`),
    index("threads_archived_updated_id_idx")
      .on(table.updatedAt, table.id)
      .where(sql`${table.archivedAt} IS NOT NULL`),
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
    sequence: integer("sequence").notNull(),
    type: text("type").$type<ThreadEventType>().notNull(),
    itemId: text("item_id"),
    itemKind: text("item_kind").$type<ThreadEventItemType>(),
    data: text("data").notNull().default("{}"),
    // (device, position) of the merged-log row, both null for a local event. not the
    // account-global seq: after signing in again the same seq names another account's row, so an
    // idempotency check keyed on it would skip a genuine event. no CHECK pairs them, for the
    // reason on threads.provider_id.
    originDeviceId: text("origin_device_id"),
    originDeviceSeq: integer("origin_device_seq"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_thread_sequence_idx").on(table.threadId, table.sequence),
    // sqlite treats nulls as distinct in a unique index, so locally-written rows (both null)
    // coexist.
    uniqueIndex("events_origin_idx").on(table.originDeviceId, table.originDeviceSeq),
    index("events_thread_turn_type_item_sequence_idx").on(
      table.threadId,
      table.turnId,
      table.type,
      table.itemId,
      table.sequence,
    ),
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
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    sortKey: text("sort_key").notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    // json array of vault paths, null for none. Kept, unlike the view context the queue drops:
    // an @-mention is part of what the user asked, not a statement about a screen since left.
    contextPaths: text("context_paths"),
  },
  (table) => [
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
    index("pending_interactions_thread_status_created_idx").on(
      table.threadId,
      table.status,
      table.createdAt,
    ),
  ],
);

// device_seq is the wire position: not events.sequence (per thread, it orders nothing about a
// device) and not MAX() over this table (a pushed row is deleted, so a shrinking table would
// re-hand a position the log holds); its high-water is sync_state. body is frozen at enqueue:
// re-serializing at push time is a sync-conflict, not a retry. no foreign key to threads: a
// cascade would drop a position the log's high-water has passed.
export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    id: text("id").primaryKey(),
    deviceSeq: integer("device_seq").notNull(),
    threadId: text("thread_id").notNull(),
    body: text("body").notNull(),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [uniqueIndex("sync_outbox_device_seq_idx").on(table.deviceSeq)],
);

export const syncState = sqliteTable(
  "sync_state",
  {
    id: integer("id").primaryKey(),
    lastDeviceSeq: integer("last_device_seq").notNull().default(0),
    cursor: integer("cursor").notNull().default(0),
    lastSyncedAt: integer("last_synced_at"),
    // the lowest log row a pull moved past without being able to read it, and the build that
    // could not: a different build rewinds the cursor to pull it again. no CHECK pairs them, for
    // the reason on threads.provider_id.
    skippedFromSeq: integer("skipped_from_seq"),
    skippedByBuild: text("skipped_by_build"),
  },
  (table) => [check("sync_state_singleton_check", sql`${table.id} = 1`)],
);

// captures are at-least-once: a device that applied and then lost its claim is handed the same
// capture again, and this makes the second apply a no-op. pruned by age, since an acked capture
// never redelivers.
export const syncAppliedCaptures = sqliteTable("sync_applied_captures", {
  id: text("id").primaryKey(),
  appliedAt: integer("applied_at").notNull(),
});

// every device id this install has signed in as. the log keeps a sign-in's rows after it ends,
// and this install already holds them as local events with a null origin, which the origin
// dedupe cannot see; a pull skips a row under any of these ids. outlives a sign-out on purpose:
// forgetting an id re-applies everything written under it.
export const syncOwnDevices = sqliteTable("sync_own_devices", {
  deviceId: text("device_id").primaryKey(),
});
/* oxlint-enable sort-keys */
