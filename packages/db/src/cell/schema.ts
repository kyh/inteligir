// The library cell's SQLite: every table but `search_fts`, an FTS5 virtual table sqlite-core cannot
// declare, which its own custom migration makes. drizzle-kit generates the cell's migrations from
// this file (drizzle.config.cell.ts). No table is STRICT or WITHOUT ROWID, which sqlite-core cannot
// spell and a generated recreate would drop, and no trigger sits on one, since a recreate drops
// that too: the search index is kept in code.

import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import { FETCH_STATES } from "@repo/contract/library/library-item";
import { LIBRARY_SECTIONS } from "@repo/contract/library/library-nodes";
import {
  CHANGE_SET_ACTORS,
  IMPORT_PHASES,
  IMPORT_SOURCES,
  IMPORT_STATES,
} from "@repo/contract/library/library-wire";

const TAG_ORIGINS = ["field", "inline"] as const;

// a CHECK's list, spelled from the vocabulary it holds a column to
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// a column with no declared type takes BLOB affinity and keeps what it is handed; `ANY` outside a
// STRICT table takes NUMERIC affinity, which would hand the person's rules "42" back as 42
const untyped = customType<{ data: string | number; driverData: string | number }>({
  dataType: () => "",
});

export const meta = sqliteTable("meta", {
  k: text().primaryKey(),
  v: untyped(),
});

// a purged item keeps its id, sequence and deletion as a tombstone forever and nulls the rest, so
// no id is ever made again, an import's or a late save's included; every other row holds its
// whole record. `rid` is the search index's row id, so a write replaces its index row in place
export const items = sqliteTable(
  "items",
  {
    rid: integer().primaryKey(),
    id: text().notNull(),
    kind: text({ enum: ITEM_KINDS }),
    title: text(),
    folderId: text("folder_id"),
    aliases: text(),
    tags: text(),
    properties: text(),
    url: text(),
    urlKey: text("url_key"),
    site: text(),
    author: text(),
    published: text(),
    description: text(),
    lang: text(),
    coverSha: text("cover_sha"),
    originalSha: text("original_sha"),
    originalName: text("original_name"),
    fetchState: text("fetch_state", { enum: FETCH_STATES }),
    fetchedAt: integer("fetched_at"),
    fetchError: text("fetch_error"),
    savedAt: integer("saved_at"),
    updatedAt: integer("updated_at").notNull(),
    pinnedAt: integer("pinned_at"),
    deletedAt: integer("deleted_at"),
    purged: integer().notNull().default(0),
    card: text(),
    seq: integer().notNull(),
  },
  (t) => [
    uniqueIndex("items_id").on(t.id),
    // one url, one live item
    uniqueIndex("one_url")
      .on(t.urlKey)
      .where(sql`${t.deletedAt} IS NULL AND ${t.urlKey} IS NOT NULL`),
    index("items_seq").on(t.seq),
    check("items_kind", sql`${t.kind} IN (${oneOf(ITEM_KINDS)})`),
    check("items_fetch_state", sql`${t.fetchState} IN (${oneOf(FETCH_STATES)})`),
    check("items_purged", sql`${t.purged} IN (0, 1)`),
    check(
      "items_whole",
      sql`${t.purged} = 1 OR (${t.kind} IS NOT NULL AND ${t.title} IS NOT NULL
        AND ${t.aliases} IS NOT NULL AND ${t.tags} IS NOT NULL AND ${t.properties} IS NOT NULL
        AND ${t.fetchState} IS NOT NULL AND ${t.savedAt} IS NOT NULL AND ${t.card} IS NOT NULL)`,
    ),
  ],
);

export const blocks = sqliteTable(
  "blocks",
  {
    itemId: text("item_id").notNull(),
    blockId: text("block_id").notNull(),
    ord: text().notNull(),
    section: text({ enum: LIBRARY_SECTIONS }).notNull(),
    json: text().notNull(),
    hash: text().notNull(),
    text: text().notNull(),
    seq: integer().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.blockId] }),
    check("blocks_section", sql`${t.section} IN (${oneOf(LIBRARY_SECTIONS)})`),
  ],
);

export const folders = sqliteTable("folders", {
  id: text().primaryKey(),
  parentId: text("parent_id"),
  name: text().notNull(),
  sort: text().notNull(),
  deletedAt: integer("deleted_at"),
  seq: integer().notNull(),
});

export const itemTags = sqliteTable(
  "item_tags",
  {
    itemId: text("item_id").notNull(),
    tag: text().notNull(),
    origin: text({ enum: TAG_ORIGINS }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.tag, t.origin] }),
    index("item_tags_tag").on(t.tag),
    check("item_tags_origin", sql`${t.origin} IN (${oneOf(TAG_ORIGINS)})`),
  ],
);

export const links = sqliteTable(
  "links",
  {
    sourceId: text("source_id").notNull(),
    targetId: text("target_id"),
    targetKey: text("target_key"),
  },
  (t) => [
    index("links_source").on(t.sourceId),
    index("links_target").on(t.targetId),
    index("links_key").on(t.targetKey),
  ],
);

export const threads = sqliteTable("threads", {
  id: text().primaryKey(),
  title: text().notNull(),
  status: text().notNull(),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  seq: integer().notNull(),
});

export const threadEvents = sqliteTable(
  "thread_events",
  {
    eventId: text("event_id").primaryKey(),
    threadId: text("thread_id").notNull(),
    idx: integer().notNull(),
    type: text().notNull(),
    json: text().notNull(),
    at: integer().notNull(),
    seq: integer().notNull(),
  },
  (t) => [index("thread_events_thread").on(t.threadId, t.idx)],
);

// the files the cell holds and the items naming each, which no device reads, since a device asks
// for a file by the sha an item's row names
export const blobs = sqliteTable("blobs", {
  sha256: text().primaryKey(),
  bytes: integer().notNull(),
  mime: text().notNull(),
  refs: integer().notNull(),
});

export const itemBlobs = sqliteTable(
  "item_blobs",
  {
    itemId: text("item_id").notNull(),
    sha256: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.sha256] })],
);

// A change set's item names its before and after by part: an item's fields and its manifest (each
// block's id, hash, order key and section) are each kept once per item under their content hash
// (`snapshot_parts`), so a set that changed one block stores one new manifest and nothing else,
// and no row nears a Durable Object's 2 MB. A set's after is null while the set is open and the
// item is as it left it; it is written when the set seals, or when another set is about to change
// the item. A block a write replaces or drops keeps its content in `block_versions`, which the
// prune job sweeps of what no part names
export const changeSets = sqliteTable(
  "change_sets",
  {
    id: text().primaryKey(),
    actor: text({ enum: CHANGE_SET_ACTORS }).notNull(),
    actorId: text("actor_id"),
    label: text().notNull(),
    deviceId: text("device_id"),
    threadId: text("thread_id"),
    turn: integer(),
    clientId: text("client_id"),
    openedAt: integer("opened_at").notNull(),
    touchedAt: integer("touched_at").notNull(),
    sealedAt: integer("sealed_at"),
    undoneBy: text("undone_by"),
  },
  (t) => [
    index("change_sets_open").on(t.actor, t.sealedAt),
    check("change_sets_actor", sql`${t.actor} IN (${oneOf(CHANGE_SET_ACTORS)})`),
  ],
);

export const changeSetItems = sqliteTable(
  "change_set_items",
  {
    changeSetId: text("change_set_id").notNull(),
    itemId: text("item_id").notNull(),
    created: integer().notNull(),
    beforeFields: text("before_fields"),
    beforeManifest: text("before_manifest"),
    afterFields: text("after_fields"),
    afterManifest: text("after_manifest"),
  },
  (t) => [
    primaryKey({ columns: [t.changeSetId, t.itemId] }),
    index("change_set_items_item").on(t.itemId),
    check("change_set_items_created", sql`${t.created} IN (0, 1)`),
    check("change_set_items_made", sql`(${t.created} = 1) = (${t.beforeFields} IS NULL)`),
    check(
      "change_set_items_before",
      sql`(${t.beforeFields} IS NULL) = (${t.beforeManifest} IS NULL)`,
    ),
    check("change_set_items_after", sql`(${t.afterFields} IS NULL) = (${t.afterManifest} IS NULL)`),
  ],
);

export const snapshotParts = sqliteTable(
  "snapshot_parts",
  {
    itemId: text("item_id").notNull(),
    hash: text().notNull(),
    json: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.hash] })],
);

export const blockVersions = sqliteTable(
  "block_versions",
  {
    itemId: text("item_id").notNull(),
    hash: text().notNull(),
    json: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.hash] })],
);

// the files each fields part and block version names, so whether any change set still holds a
// file is one lookup, never a read of the parts themselves
export const changeSetBlobs = sqliteTable(
  "change_set_blobs",
  {
    itemId: text("item_id").notNull(),
    hash: text().notNull(),
    sha256: text().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.hash, t.sha256] }),
    index("change_set_blobs_sha").on(t.sha256),
  ],
);

export const appliedOps = sqliteTable(
  "applied_ops",
  {
    opId: text("op_id").primaryKey(),
    answer: text().notNull(),
    at: integer().notNull(),
  },
  (t) => [index("applied_ops_at").on(t.at)],
);

export const blobUploads = sqliteTable("blob_uploads", {
  sha256: text().primaryKey(),
  bytes: integer().notNull(),
  mime: text().notNull(),
});

// the built-in agent's switch: no row is on, the default, since there is no credential to make
export const agentSwitch = sqliteTable(
  "agent_switch",
  {
    slot: integer().primaryKey(),
    enabled: integer().notNull(),
  },
  (t) => [
    check("agent_switch_slot", sql`${t.slot} = 1`),
    check("agent_switch_enabled", sql`${t.enabled} IN (0, 1)`),
  ],
);

// each thread's open turn, at most one: its number in the thread, which keys the change set its
// writes open, what the person sent, how many of its calls wait on the person, whether the person
// stopped it, and when its conversation's object was last heard from, which the watch job asks
// after
export const agentTurns = sqliteTable(
  "agent_turns",
  {
    threadId: text("thread_id").primaryKey(),
    turn: integer().notNull(),
    message: text().notNull(),
    waiting: integer().notNull().default(0),
    cancel: integer().notNull().default(0),
    startedAt: integer("started_at").notNull(),
    heardAt: integer("heard_at").notNull(),
  },
  (t) => [
    check("agent_turns_waiting", sql`${t.waiting} >= 0`),
    check("agent_turns_cancel", sql`${t.cancel} IN (0, 1)`),
  ],
);

// every model call a turn reserved before it was sent: what it may spend, in micro-cents, and once
// its reply or its cut is pushed what it cost, on the day it was reserved; a call cut short reports
// no usage, so it is booked at what it reserved and marked cut
export const agentCalls = sqliteTable(
  "agent_calls",
  {
    callId: text("call_id").primaryKey(),
    threadId: text("thread_id").notNull(),
    turn: integer().notNull(),
    day: text().notNull(),
    reservedUcents: integer("reserved_ucents").notNull(),
    maxTokens: integer("max_tokens").notNull(),
    costUcents: integer("cost_ucents"),
    cut: integer().notNull().default(0),
  },
  (t) => [
    index("agent_calls_turn").on(t.threadId, t.turn),
    index("agent_calls_open").on(t.costUcents),
    check("agent_calls_cut", sql`${t.cut} IN (0, 1)`),
  ],
);

// the last push each thread's object landed, so a push sent again lands nothing
export const agentPushes = sqliteTable("agent_pushes", {
  threadId: text("thread_id").primaryKey(),
  seq: integer().notNull(),
});

// the sends that wait for their thread's turn, or for one of the account's turns at once, oldest
// first
export const agentQueue = sqliteTable(
  "agent_queue",
  {
    id: text().primaryKey(),
    threadId: text("thread_id").notNull(),
    message: text().notNull(),
    queuedAt: integer("queued_at").notNull(),
  },
  (t) => [index("agent_queue_order").on(t.queuedAt, t.id)],
);

// what the built-in agent spent on each UTC day: its turns, and their calls' list cost in
// micro-cents
export const agentUsage = sqliteTable("agent_usage", {
  day: text().primaryKey(),
  turns: integer().notNull(),
  costUcents: integer("cost_ucents").notNull(),
});

export const importJobs = sqliteTable(
  "import_jobs",
  {
    id: text().primaryKey(),
    source: text({ enum: IMPORT_SOURCES }).notNull(),
    sha: text().notNull(),
    state: text({ enum: IMPORT_STATES }).notNull(),
    phase: text({ enum: IMPORT_PHASES }).notNull(),
    cursor: integer().notNull(),
    total: integer().notNull(),
    added: integer().notNull(),
    alreadySaved: integer("already_saved").notNull(),
    skipped: integer().notNull(),
    unreadable: integer().notNull(),
    changeSetId: text("change_set_id"),
    message: text(),
    startedAt: integer("started_at").notNull(),
    finishedAt: integer("finished_at"),
  },
  (t) => [
    check("import_jobs_source", sql`${t.source} IN (${oneOf(IMPORT_SOURCES)})`),
    check("import_jobs_state", sql`${t.state} IN (${oneOf(IMPORT_STATES)})`),
    check("import_jobs_phase", sql`${t.phase} IN (${oneOf(IMPORT_PHASES)})`),
  ],
);

// a running import's plan, a row per thing it lands, so a page reads only its own rows
export const importRows = sqliteTable(
  "import_rows",
  {
    jobId: text("job_id").notNull(),
    kind: text().notNull(),
    idx: integer().notNull(),
    json: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.jobId, t.kind, t.idx] })],
);

export const jobs = sqliteTable(
  "jobs",
  {
    id: text().primaryKey(),
    kind: text().notNull(),
    payload: text().notNull(),
    attempts: integer().notNull(),
    nextAt: integer("next_at"),
  },
  (t) => [index("jobs_next").on(t.nextAt)],
);
