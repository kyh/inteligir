import { AGENT_WRITE_MODE_VALUES } from "@repo/domain/agent-write-mode";
import { pendingInteractionStatusValues } from "@repo/domain/pending-interaction-status";
import type { ThreadEventItemType, ThreadEventType } from "@repo/domain/provider-event";
import { STORED_PROPOSAL_STATUS_VALUES } from "@repo/domain/proposal-status";
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
    // The provider session this thread resumes into (issue #549): which
    // provider ran it and the provider's own thread id. Written together by
    // the one writer (setThreadProviderSession) once the runtime resolves the
    // session; no CHECK pairs them because SQLite cannot ADD a checked column
    // without rebuilding the table, and a rebuild would cascade through the
    // children's foreign keys mid-migration. Survives process restarts and
    // idle-session reaping — the next turn resumes by this id.
    providerId: text("provider_id"),
    providerThreadId: text("provider_thread_id"),
    // Where this thread's turns LAND (issue #560): straight into the vault, or
    // into a reviewable proposal. Defaulted rather than nullable, because
    // "unknown" is not a mode any dispatch could act on — an existing row and
    // a caller that names nothing both mean v1's behaviour.
    writeMode: text("write_mode", { enum: AGENT_WRITE_MODE_VALUES }).notNull().default("direct"),
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
    // The open note asks "which threads are bound to THIS doc?" on every
    // thread invalidation, and a rename rebinds by the same key — both are
    // scans of one column, so both get this index instead of the table.
    index("threads_origin_doc_idx").on(table.originDocPath),
    // One anchor, one thread: the client mints the token, and a duplicate
    // would give a chip two threads to open with no way to choose.
    uniqueIndex("threads_origin_anchor_idx").on(table.originAnchor),
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
 * A suggested edit a review-mode turn captured instead of landing (issue
 * #560): one row per file the turn wrote, holding BOTH sides whole.
 *
 * WHOLE CONTENT, NOT HUNKS. The hunk list every surface renders is
 * `diffLines(base, proposed)` — the Myers walk `@repo/notes/text` already
 * carries for diff3 and the editor's external replace — so storing hunks
 * would be storing a derivation of these two columns that can disagree with
 * them, and a partial accept would need a second assembler to turn hunks back
 * into the bytes a write takes. With the content stored, the bytes applied
 * ARE the bytes recorded, per-hunk accept is a rewrite of this same pair, and
 * a vault file (10MB ceiling, KBs in practice) beside a git object store that
 * already holds every revision is not the cost worth optimising.
 *
 * `base_hash` NULL means the file did not exist — a creation. `proposed`
 * NULL means the turn deleted it. Both may not be null at once: a proposal
 * that neither creates nor changes anything has nothing to review.
 *
 * `revision` is the identity of the (base, proposed) PAIR. Both columns are
 * rewritten by a per-hunk accept or reject, so a client acting on hunks it
 * rendered a moment ago names the revision it rendered and a rewrite in
 * between refuses instead of applying hunk 2 of a different diff.
 */
export const proposals = sqliteTable(
  "proposals",
  {
    id: text("id").primaryKey(),
    threadId: text("thread_id")
      .notNull()
      .references(() => threads.id, { onDelete: "cascade" }),
    /** The turn that produced it; null once that identity is no longer known. */
    turnId: text("turn_id"),
    docPath: text("doc_path").notNull(),
    /** The git revision the base bytes were read from — what a re-run rebases
     *  against, and what makes "which base" answerable after the fact. */
    baseRev: text("base_rev"),
    baseHash: text("base_hash"),
    baseContent: text("base_content").notNull(),
    proposedContent: text("proposed_content"),
    status: text("status", { enum: STORED_PROPOSAL_STATUS_VALUES }).notNull(),
    revision: integer("revision").notNull(),
    // How many hunks of this suggestion reached disk. The resolved status is
    // read off it, and it has to be counted rather than inferred: after a
    // mixed review the base has moved and the proposal is empty, which looks
    // identical whether the hunks were taken or discarded. Answering
    // "rejected" for a suggestion whose edits ARE in the file is the one
    // outcome the history must never claim.
    acceptedHunks: integer("accepted_hunks").notNull().default(0),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    resolvedAt: integer("resolved_at"),
  },
  (table) => [
    // ONE pending proposal per (thread, doc): a second turn on the same thread
    // is refining the same work, so its capture SUPERSEDES rather than stacks.
    // Two pending rows for one file would each claim a base the other's accept
    // invalidates, and the second would read stale the moment the first landed.
    uniqueIndex("proposals_thread_doc_pending_idx")
      .on(table.threadId, table.docPath)
      .where(sql`${table.status} = 'pending'`),
    // The editor's gutter asks "what is proposed against THIS doc?" on every
    // proposal invalidation; the dock asks the same by thread.
    index("proposals_doc_status_idx").on(table.docPath, table.status),
    index("proposals_thread_status_idx").on(table.threadId, table.status),
    check(
      "proposals_has_change_check",
      sql`${table.baseHash} IS NOT NULL OR ${table.proposedContent} IS NOT NULL`,
    ),
  ],
);
