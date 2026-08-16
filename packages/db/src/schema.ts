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
    // Set together for a doc-bound delegation (issue #552): the vault doc the
    // thread was spawned from and the stable anchor inside it. Both null for a
    // plain chat thread; the CHECK makes a half-bound origin unrepresentable.
    originDocPath: text("origin_doc_path"),
    originAnchor: text("origin_anchor"),
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
    check(
      "threads_origin_pair_check",
      sql`(${table.originDocPath} IS NULL) = (${table.originAnchor} IS NULL)`,
    ),
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
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_thread_sequence_idx").on(table.threadId, table.sequence),
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

export const pendingInteractionStatusValues = [
  "pending",
  "resolving",
  "resolved",
  "interrupted",
] as const;
export type PendingInteractionStatusValue = (typeof pendingInteractionStatusValues)[number];

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
