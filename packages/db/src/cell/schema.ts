// The library cell's SQLite: every table but `search_fts`, an FTS5 virtual table sqlite-core cannot
// declare, which scripts/object-ddl.ts appends to the DDL drizzle-kit exports from this file
// (ddl.sql). No table is STRICT or WITHOUT ROWID, and no trigger sits on one, since the exported
// DDL spells none of them: the search index is kept in code.

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

import { z } from "zod";

import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import { bodyDigestSchema, itemCardSchema } from "@repo/contract/library/derive-item";
import type { BodyDigest, ItemCard } from "@repo/contract/library/derive-item";
import { FETCH_STATES, libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import { LIBRARY_SECTIONS, libraryBlockSchema } from "@repo/contract/library/library-nodes";
import {
  agentViewContextSchema,
  CHANGE_SET_ACTORS,
  THREAD_STATUSES,
} from "@repo/contract/library/library-wire";

const TAG_ORIGINS = ["field", "inline"] as const;

// where an item's body lives: in the cell's `seed_blocks` until its note first opens; `opening`
// once the note has read its seed, which the cell keeps until the note's first projection lands;
// then in the note's own object, of which the cell keeps the projection
export const BODY_HOMES = ["seed", "opening", "note"] as const;

// a CHECK's list, spelled from the vocabulary it holds a column to
const oneOf = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(", "));

// JSON a column holds, read back through its schema, so a row is the type it was written as or no
// row at all
const json = <T>(schema: z.ZodType<T>) =>
  customType<{ data: T; driverData: string }>({
    dataType: () => "text",
    fromDriver: (stored) => schema.parse(JSON.parse(stored)),
    toDriver: (value) => JSON.stringify(value),
  });

const FIELDS = libraryItemFieldsSchema.shape;

// what the cell holds once, in its one row: the sequence its last write took, when the account's
// deletion began, the stray removals R2 has finished, and the person's filing rules
export const cellState = sqliteTable(
  "cell_state",
  {
    slot: integer().primaryKey(),
    head: integer().notNull().default(0),
    deletedAt: integer("deleted_at"),
    blobRemovals: integer("blob_removals").notNull().default(0),
    rules: text(),
  },
  (t) => [check("cell_state_slot", sql`${t.slot} = 1`)],
);

// an item, in Deleted or not, whole: its fields, and of its body where it lives, the digest its card
// and index derive from, and for a note the version of the projection landed and the bytes its
// object holds. `rid` is the search index's row id, so a write replaces its index row in place
export const items = sqliteTable(
  "items",
  {
    rid: integer().primaryKey(),
    id: text().notNull(),
    kind: text({ enum: ITEM_KINDS }).notNull(),
    title: text().notNull(),
    folderId: text("folder_id"),
    aliases: json(FIELDS.aliases)().notNull(),
    tags: json(FIELDS.tags)().notNull(),
    properties: json(FIELDS.properties)().notNull(),
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
    fetchState: text("fetch_state", { enum: FETCH_STATES }).notNull(),
    fetchedAt: integer("fetched_at"),
    fetchError: text("fetch_error"),
    savedAt: integer("saved_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
    pinnedAt: integer("pinned_at"),
    deletedAt: integer("deleted_at"),
    card: json<ItemCard>(itemCardSchema)().notNull(),
    bodyHome: text("body_home", { enum: BODY_HOMES }).notNull(),
    bodyDigest: json<BodyDigest>(bodyDigestSchema)("body_digest").notNull(),
    bodyVersion: integer("body_version").notNull(),
    bodyBytes: integer("body_bytes").notNull(),
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
    check("items_body_home", sql`${t.bodyHome} IN (${oneOf(BODY_HOMES)})`),
  ],
);

// an item emptied from Deleted: its id, kept forever so no id is ever made again, an import's or a
// late save's included, and the sequence of the write that purged it, which a listing catches up
// by. An id is an item's or a purged one's, never both
export const purgedItems = sqliteTable(
  "purged_items",
  {
    id: text().primaryKey(),
    seq: integer().notNull(),
  },
  (t) => [index("purged_items_seq").on(t.seq)],
);

// a body the cell keeps until its note first opens, a top-level block a row in reading order; the
// note's first load reads them, and its confirm drops them
export const seedBlocks = sqliteTable(
  "seed_blocks",
  {
    itemId: text("item_id").notNull(),
    pos: integer().notNull(),
    blockId: text("block_id").notNull(),
    section: text({ enum: LIBRARY_SECTIONS }).notNull(),
    json: json(libraryBlockSchema)().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.itemId, t.pos] }),
    check("seed_blocks_section", sql`${t.section} IN (${oneOf(LIBRARY_SECTIONS)})`),
  ],
);

// an item's body as text, cut at line ends into parts a row holds, whether the cell keeps the body
// or a note projects it: what search's literal tier matches and a hit's passage is cut from, the
// one copy of the text the index ranks
export const bodyTexts = sqliteTable(
  "body_texts",
  {
    itemId: text("item_id").notNull(),
    part: integer().notNull(),
    text: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.part] })],
);

// a session's open sockets on notes, which the Worker's door records as it opens one, so the
// session's end closes them too
export const noteSockets = sqliteTable(
  "note_sockets",
  {
    sessionId: text("session_id").notNull(),
    itemId: text("item_id").notNull(),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.itemId] })],
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

export const threads = sqliteTable(
  "threads",
  {
    id: text().primaryKey(),
    title: text().notNull(),
    status: text({ enum: THREAD_STATUSES }).notNull(),
    createdAt: integer("created_at").notNull(),
    updatedAt: integer("updated_at").notNull(),
  },
  (t) => [check("threads_status", sql`${t.status} IN (${oneOf(THREAD_STATUSES)})`)],
);

export const threadEvents = sqliteTable(
  "thread_events",
  {
    eventId: text("event_id").primaryKey(),
    threadId: text("thread_id").notNull(),
    idx: integer().notNull(),
    type: text().notNull(),
    json: json(z.json())().notNull(),
    at: integer().notNull(),
  },
  (t) => [index("thread_events_thread").on(t.threadId, t.idx)],
);

// the files the cell holds and the items naming each, which no device reads, since a device asks
// for a file by the sha an item's row names
export const blobs = sqliteTable("blobs", {
  sha256: text().primaryKey(),
  bytes: integer().notNull(),
  mime: text().notNull(),
});

export const itemBlobs = sqliteTable(
  "item_blobs",
  {
    itemId: text("item_id").notNull(),
    sha256: text().notNull(),
  },
  (t) => [primaryKey({ columns: [t.itemId, t.sha256] }), index("item_blobs_sha").on(t.sha256)],
);

// A change set's item names its fields before and after by part, each kept once per item under its
// content hash (`snapshot_parts`), so no row nears a Durable Object's 2 MB. A set's after is null
// while the set is open and the item is as it left it; it is written when the set seals, or when
// another set is about to change the item. A body is no part: the agent's edits to it are its
// note's turn log, and a person's typing is no change set
export const changeSets = sqliteTable(
  "change_sets",
  {
    id: text().primaryKey(),
    actor: text({ enum: CHANGE_SET_ACTORS }).notNull(),
    actorId: text("actor_id"),
    label: text().notNull(),
    sessionId: text("session_id"),
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
    created: integer({ mode: "boolean" }).notNull(),
    beforeFields: text("before_fields"),
    afterFields: text("after_fields"),
  },
  (t) => [
    primaryKey({ columns: [t.changeSetId, t.itemId] }),
    index("change_set_items_item").on(t.itemId),
    check("change_set_items_created", sql`${t.created} IN (0, 1)`),
    check("change_set_items_made", sql`(${t.created} = 1) = (${t.beforeFields} IS NULL)`),
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

// the files each fields part names, so whether any change set still holds a file is one lookup,
// never a read of the parts themselves
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
    enabled: integer({ mode: "boolean" }).notNull(),
  },
  (t) => [
    check("agent_switch_slot", sql`${t.slot} = 1`),
    check("agent_switch_enabled", sql`${t.enabled} IN (0, 1)`),
  ],
);

// what a send carries into its turn: the person's words, and the screen they wrote from
const turnMessageSchema = z.object({
  text: z.string().min(1),
  viewContext: agentViewContextSchema.nullable(),
});

// each thread's open turn, at most one: its number in the thread, which keys the change set its
// writes open, what the person sent, how many of its calls wait on the person, whether the person
// stopped it, and when its conversation's object was last heard from, which the watch job asks
// after
export const agentTurns = sqliteTable(
  "agent_turns",
  {
    threadId: text("thread_id").primaryKey(),
    turn: integer().notNull(),
    message: json(turnMessageSchema)().notNull(),
    waiting: integer().notNull().default(0),
    cancel: integer({ mode: "boolean" }).notNull().default(false),
    startedAt: integer("started_at").notNull(),
    heardAt: integer("heard_at").notNull(),
  },
  (t) => [
    check("agent_turns_waiting", sql`${t.waiting} >= 0`),
    check("agent_turns_cancel", sql`${t.cancel} IN (0, 1)`),
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
    message: json(turnMessageSchema)().notNull(),
    queuedAt: integer("queued_at").notNull(),
  },
  (t) => [index("agent_queue_order").on(t.queuedAt, t.id)],
);

// the turns the built-in agent began on each UTC day
export const agentUsage = sqliteTable("agent_usage", {
  day: text().primaryKey(),
  turns: integer().notNull(),
});

// what the cell's alarm runs, in the order a run takes the kinds: the storage's own first, so a
// file one of them lets go is a stray the same run takes out of R2
export const JOB_KINDS = [
  "seal",
  "prune",
  "upload",
  "unnamed",
  "fill",
  "stray",
  "note-purge",
  "agent-deliver",
  "agent-watch",
] as const;

// a job waits until `next_at`; `attempts` counts the runs that took it since it was last asked for
export const jobs = sqliteTable(
  "jobs",
  {
    id: text().primaryKey(),
    kind: text({ enum: JOB_KINDS }).notNull(),
    payload: text().notNull(),
    attempts: integer().notNull(),
    nextAt: integer("next_at").notNull(),
  },
  (t) => [
    index("jobs_next").on(t.nextAt),
    check("jobs_kind", sql`${t.kind} IN (${oneOf(JOB_KINDS)})`),
  ],
);
