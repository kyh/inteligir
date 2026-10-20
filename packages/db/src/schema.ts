import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import { pendingInteractionApprovalDecisionValues } from "@repo/domain/pending-interactions";
import type { ThreadEventItemType, ThreadEventType } from "@repo/domain/provider-event";
import type { ThreadEventScopeKind } from "@repo/domain/thread-event-scope";
import { threadStatusValues } from "@repo/domain/thread-status";
import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// a table's column order is the CREATE TABLE order drizzle-kit emits; sorting it makes the next
// generated migration recreate every table.

// schema_version is seeded by the baseline and bumped by every later migration.
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
    // the origin note's frontmatter `id`, which a move anywhere (Finder, a pull, an agent's `mv`)
    // keeps; origin_doc_path stays the path at compose time and answers for a note with none. no
    // index: the listing filters by it (and by origin_doc_path) inside the (updated_at, id)
    // partial-index scan, which a vault's thread count keeps cheap.
    originNoteId: text("origin_note_id"),
    // the harness a session was opened on: a session id never stands without it.
    providerId: text("provider_id"),
    providerThreadId: text("provider_thread_id"),
    archivedAt: integer("archived_at"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
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
    check(
      "threads_origin_shape_check",
      sql`${table.originNoteId} IS NULL OR ${table.originDocPath} IS NOT NULL`,
    ),
    check(
      "threads_provider_session_check",
      sql`${table.providerThreadId} IS NULL OR ${table.providerId} IS NOT NULL`,
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
    sequence: integer("sequence").notNull(),
    type: text("type").$type<ThreadEventType>().notNull(),
    itemId: text("item_id"),
    itemKind: text("item_kind").$type<ThreadEventItemType>(),
    data: text("data").notNull().default("{}"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_thread_sequence_idx").on(table.threadId, table.sequence),
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
    sortKey: text("sort_key").notNull(),
    text: text("text").notNull(),
    // json array of vault paths, null for none. Kept, unlike the view context the queue drops:
    // an @-mention is part of what the user asked, not a statement about a screen since left.
    contextPaths: text("context_paths"),
    // the named action the message asks for (an ActionPreset), null for none. Kept for the same
    // reason: the preset is what was asked, and its block is composed when the message drains.
    preset: text("preset"),
    claimedAt: integer("claimed_at"),
    claimToken: text("claim_token"),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (table) => [
    index("queued_thread_messages_thread_sort_idx").on(table.threadId, table.sortKey, table.id),
    check(
      "queued_thread_messages_claim_shape_check",
      sql`(${table.claimedAt} IS NULL) = (${table.claimToken} IS NULL)`,
    ),
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
    decision: text("decision", { enum: pendingInteractionApprovalDecisionValues }),
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
    check(
      "pending_interactions_decision_shape_check",
      sql`(${table.status} = 'resolved') = (${table.decision} IS NOT NULL)`,
    ),
  ],
);

// the stubs this Mac will fill, one row per item, written per transition rather than as one file
// rewritten whole (an import of thousands moves every row). `origin` says which of this Mac's own
// writes made the stub, a save or its import, which decides its lane; another device fills its own.
export const pendingFillOriginValues = ["own", "import"] as const;

export const pendingFills = sqliteTable(
  "pending_fills",
  {
    // the stub's frontmatter id
    itemId: text("item_id").primaryKey(),
    // its path now: a rename updates it
    path: text("path").notNull(),
    url: text("url").notNull(),
    origin: text("origin", { enum: pendingFillOriginValues }).notNull(),
    keepCopy: integer("keep_copy", { mode: "boolean" }).notNull().default(false),
    // an imported Raindrop cover url, which the fill tries before the page's own
    coverHint: text("cover_hint"),
    attempts: integer("attempts").notNull().default(0),
    // epoch ms
    firstSeenAt: integer("first_seen_at").notNull(),
    // epoch ms: not tried before this
    notBefore: integer("not_before").notNull(),
  },
  (table) => [index("pending_fills_not_before_idx").on(table.notBefore)],
);
