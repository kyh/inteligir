// Every account's library, in tables keyed by `account_id` first: the items with their bodies, the
// rows derived from them, folders, change sets, the op ledger, files and jobs. A root table's account
// cascades from Better Auth's `user`, and every other table hangs off its parent by a composite
// foreign key, so deleting a user empties the library and no row points into another account.
// Times are unix milliseconds and ids text, as the library model spells them.

import { ITEM_KINDS } from "@repo/contract/items/item-kind";
import type {
  BodyBlock,
  BodyDigest,
  DerivedItem,
  ItemCard,
} from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  bigint,
  boolean,
  check,
  customType,
  foreignKey,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { user } from "./auth-schema";

const TAG_ORIGINS = [
  "field",
  "inline",
] as const satisfies readonly DerivedItem["tags"][number]["origin"][];

// the kinds of work a job runs after the write that asked for it; an area appends its own
const JOB_KINDS = ["fill", "file-release"] as const;

export const itemKind = pgEnum("item_kind", ITEM_KINDS);
export const tagOrigin = pgEnum("tag_origin", TAG_ORIGINS);
export const jobKind = pgEnum("job_kind", JOB_KINDS);

// drizzle has no tsvector builder; the service writes the vector as a literal it built
// (`@repo/service/search/search-vector`)
const tsvector = customType<{ data: string; driverData: string }>({
  dataType: () => "tsvector",
});

const ms = (name: string) => bigint(name, { mode: "number" });

const accountId = () =>
  text("account_id")
    .notNull()
    .references(() => user.id, { onDelete: "cascade" });

// the account's one row, which every write locks first, and the sequence its last write took
export const libraryState = pgTable.withRLS("library_state", {
  accountId: text("account_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  head: ms("head").default(0).notNull(),
});

// an item, in Deleted or not: its fields one column each, and what its row derives, so a listing
// reads the row alone. `title_sort` is its card's title as the listing orders it; `title_key` and
// `alias_keys` are its title and aliases as a `[[link]]` names it, keyed in JS, since Postgres's
// lower() folds neither Unicode form nor case as the library's key does
export const item = pgTable.withRLS(
  "item",
  {
    accountId: accountId(),
    aliasKeys: text("alias_keys").array().notNull(),
    aliases: jsonb("aliases").$type<LibraryItemFields["aliases"]>().notNull(),
    author: text("author"),
    card: jsonb("card").$type<ItemCard>().notNull(),
    coverSha: text("cover_sha"),
    deletedAt: ms("deleted_at"),
    description: text("description"),
    folderId: text("folder_id"),
    id: text("id").notNull(),
    kind: itemKind("kind").notNull(),
    lang: text("lang"),
    originalName: text("original_name"),
    originalSha: text("original_sha"),
    pinned: boolean("pinned").generatedAlwaysAs(sql`pinned_at is not null`),
    pinnedAt: ms("pinned_at"),
    properties: jsonb("properties").$type<LibraryItemFields["properties"]>().notNull(),
    published: text("published"),
    reading: jsonb("reading").$type<LibraryItemFields["reading"]>().notNull(),
    savedAt: ms("saved_at").notNull(),
    seq: ms("seq").notNull(),
    site: text("site"),
    tags: jsonb("tags").$type<LibraryItemFields["tags"]>().notNull(),
    title: text("title").notNull(),
    titleKey: text("title_key").notNull(),
    titleSort: text("title_sort").notNull(),
    updatedAt: ms("updated_at").notNull(),
    url: text("url"),
    urlKey: text("url_key"),
  },
  // drizzle's desc() alone is DESC NULLS LAST, which a plain ORDER BY ... DESC cannot scan
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    uniqueIndex("item_one_url")
      .on(table.accountId, table.urlKey)
      .where(sql`${table.deletedAt} is null and ${table.urlKey} is not null`),
    index("item_live_saved")
      .on(
        table.accountId,
        table.pinned.desc().nullsFirst(),
        table.savedAt.desc().nullsFirst(),
        table.id,
      )
      .where(sql`${table.deletedAt} is null`),
    index("item_live_modified")
      .on(
        table.accountId,
        table.pinned.desc().nullsFirst(),
        table.updatedAt.desc().nullsFirst(),
        table.id,
      )
      .where(sql`${table.deletedAt} is null`),
    index("item_live_title")
      .on(
        table.accountId,
        table.pinned.desc().nullsFirst(),
        sql`${table.titleSort} collate "C"`,
        table.id,
      )
      .where(sql`${table.deletedAt} is null`),
    index("item_deleted")
      .on(table.accountId, table.deletedAt.desc().nullsFirst(), table.id)
      .where(sql`${table.deletedAt} is not null`),
    index("item_seq").on(table.accountId, table.seq),
    index("item_live_title_key")
      .on(table.accountId, table.titleKey)
      .where(sql`${table.deletedAt} is null`),
    index("item_live_alias_keys")
      .using("gin", table.aliasKeys)
      .where(sql`${table.deletedAt} is null`),
  ],
);

const itemFk = (name: string, columns: [AnyPgColumn, AnyPgColumn]) =>
  foreignKey({ columns, foreignColumns: [item.accountId, item.id], name }).onDelete("cascade");

// an item's body: its blocks, the version each write moves, its UTF-8 bytes, which the quota
// counts, and the digest its card and search row are derived again from when only fields change
export const itemBody = pgTable.withRLS(
  "item_body",
  {
    accountId: text("account_id").notNull(),
    blocks: jsonb("blocks").$type<readonly BodyBlock[]>().notNull(),
    bytes: integer("bytes").notNull(),
    digest: jsonb("digest").$type<BodyDigest>().notNull(),
    itemId: text("item_id").notNull(),
    version: integer("version").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.itemId] }),
    itemFk("item_body_item_fk", [table.accountId, table.itemId]),
  ],
);

// what search ranks an item by, and its body's plain text, which the literal tier matches and a
// passage is cut from
export const itemSearch = pgTable.withRLS(
  "item_search",
  {
    accountId: text("account_id").notNull(),
    itemId: text("item_id").notNull(),
    text: text("text").notNull(),
    vec: tsvector("vec").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.itemId] }),
    itemFk("item_search_item_fk", [table.accountId, table.itemId]),
    index("item_search_vec").using("gin", table.vec),
    index("item_search_text").using("gin", sql`lower(${table.text}) gin_trgm_ops`),
  ],
);

// a tag an item carries, from its tags field or a `#name` in its note; `tag_key` is the tag
// lowercased, which a tag's family is matched by
export const itemTag = pgTable.withRLS(
  "item_tag",
  {
    accountId: text("account_id").notNull(),
    itemId: text("item_id").notNull(),
    origin: tagOrigin("origin").notNull(),
    tag: text("tag").notNull(),
    tagKey: text("tag_key").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.itemId, table.tag, table.origin] }),
    itemFk("item_tag_item_fk", [table.accountId, table.itemId]),
    index("item_tag_key").on(table.accountId, table.tagKey.op("text_pattern_ops"), table.itemId),
  ],
);

// a link an item's body holds: to an item by its id, or to an address by its url key, so a link
// saved later finds the notes that named it. No key on the target: a link outlives a purged one
export const itemLink = pgTable.withRLS(
  "item_link",
  {
    accountId: text("account_id").notNull(),
    sourceId: text("source_id").notNull(),
    targetId: text("target_id"),
    targetKey: text("target_key"),
  },
  (table) => [
    uniqueIndex("item_link_once").on(
      table.accountId,
      table.sourceId,
      sql`coalesce(${table.targetId}, ${table.targetKey})`,
    ),
    itemFk("item_link_source_fk", [table.accountId, table.sourceId]),
    index("item_link_target").on(table.accountId, table.targetId),
    index("item_link_target_key").on(table.accountId, table.targetKey),
    check("item_link_target_one", sql`(${table.targetId} is null) <> (${table.targetKey} is null)`),
  ],
);

// an item emptied from Deleted: its id, kept so no id is made twice, and the sequence of the
// write that purged it, which a device catching up reads
export const purgedItem = pgTable.withRLS(
  "purged_item",
  {
    accountId: accountId(),
    id: text("id").notNull(),
    seq: ms("seq").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    index("purged_item_seq").on(table.accountId, table.seq),
  ],
);

// `sort` is a folder's order key among its siblings
export const folder = pgTable.withRLS(
  "folder",
  {
    accountId: accountId(),
    deletedAt: ms("deleted_at"),
    id: text("id").notNull(),
    name: text("name").notNull(),
    parentId: text("parent_id"),
    seq: ms("seq").notNull(),
    sort: text("sort").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    index("folder_parent").on(table.accountId, table.parentId),
  ],
);

// one built-in agent turn's writes, which its Undo takes back; open until the turn seals it
export const changeSet = pgTable.withRLS(
  "change_set",
  {
    accountId: accountId(),
    id: text("id").notNull(),
    sealedAt: ms("sealed_at"),
    threadId: text("thread_id").notNull(),
    turn: integer("turn").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    uniqueIndex("change_set_turn").on(table.accountId, table.threadId, table.turn),
    index("change_set_sealed").on(table.sealedAt),
  ],
);

const changeSetFk = (name: string, columns: [AnyPgColumn, AnyPgColumn]) =>
  foreignKey({ columns, foreignColumns: [changeSet.accountId, changeSet.id], name }).onDelete(
    "cascade",
  );

// What a set did to one item: the fields of an item it made, as it last left them, or the ops that
// take its changes back, as the service's own schema reads them
export const changeSetItem = pgTable.withRLS(
  "change_set_item",
  {
    accountId: text("account_id").notNull(),
    changeSetId: text("change_set_id").notNull(),
    inverse: jsonb("inverse"),
    itemId: text("item_id").notNull(),
    made: jsonb("made"),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.changeSetId, table.itemId] }),
    changeSetFk("change_set_item_change_set_fk", [table.accountId, table.changeSetId]),
    itemFk("change_set_item_item_fk", [table.accountId, table.itemId]),
    index("change_set_item_item").on(table.accountId, table.itemId),
    check("change_set_item_one_side", sql`(${table.made} is null) <> (${table.inverse} is null)`),
  ],
);

// a body a set's turn edited: its blocks before the turn's first edit, and its version after the
// turn's last, which an Undo writes back over only while the body still stands there
export const changeSetBody = pgTable.withRLS(
  "change_set_body",
  {
    accountId: text("account_id").notNull(),
    blocksBefore: jsonb("blocks_before").$type<readonly BodyBlock[]>().notNull(),
    changeSetId: text("change_set_id").notNull(),
    itemId: text("item_id").notNull(),
    versionAfter: integer("version_after").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.changeSetId, table.itemId] }),
    changeSetFk("change_set_body_change_set_fk", [table.accountId, table.changeSetId]),
    itemFk("change_set_body_item_fk", [table.accountId, table.itemId]),
    index("change_set_body_item").on(table.accountId, table.itemId),
  ],
);

// what a write answered under its op id, so a resend after a lost answer is told what landed; read
// back through the answering row's own schema
export const opAnswer = pgTable.withRLS(
  "op_answer",
  {
    accountId: accountId(),
    answer: jsonb("answer").notNull(),
    at: ms("at").notNull(),
    opId: text("op_id").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.opId] }),
    index("op_answer_at").on(table.at),
  ],
);

// A file the library holds, by its sha, at the one pathname its store keeps it under. `touched_at`
// moves at its settle and with each name added or dropped, which its release waits on
export const file = pgTable.withRLS(
  "file",
  {
    accountId: accountId(),
    bytes: ms("bytes").notNull(),
    createdAt: ms("created_at").notNull(),
    mime: text("mime").notNull(),
    pathname: text("pathname").notNull().unique(),
    sha256: text("sha256").notNull(),
    touchedAt: ms("touched_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.sha256] }),
    check("file_sha256_hex", sql`${table.sha256} ~ '^[0-9a-f]{64}$'`),
  ],
);

// A file the library does not hold cannot be named, and its going takes its names along: deleting
// an account cascades to its files and to the rows naming them in an order Postgres picks, which an
// immediate check fails and drizzle declares no deferred one for, so a release asks after names
// itself, under the account's lock
const fileFk = (name: string, columns: [AnyPgColumn, AnyPgColumn]) =>
  foreignKey({ columns, foreignColumns: [file.accountId, file.sha256], name }).onDelete("cascade");

export const itemFile = pgTable.withRLS(
  "item_file",
  {
    accountId: text("account_id").notNull(),
    itemId: text("item_id").notNull(),
    sha256: text("sha256").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.itemId, table.sha256] }),
    itemFk("item_file_item_fk", [table.accountId, table.itemId]),
    fileFk("item_file_file_fk", [table.accountId, table.sha256]),
    index("item_file_sha").on(table.accountId, table.sha256),
  ],
);

// the files a set's entry for an item would name again, held while the entry stands
export const changeSetFile = pgTable.withRLS(
  "change_set_file",
  {
    accountId: text("account_id").notNull(),
    changeSetId: text("change_set_id").notNull(),
    itemId: text("item_id").notNull(),
    sha256: text("sha256").notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.accountId, table.changeSetId, table.itemId, table.sha256],
    }),
    foreignKey({
      columns: [table.accountId, table.changeSetId, table.itemId],
      foreignColumns: [changeSetItem.accountId, changeSetItem.changeSetId, changeSetItem.itemId],
      name: "change_set_file_entry_fk",
    }).onDelete("cascade"),
    fileFk("change_set_file_file_fk", [table.accountId, table.sha256]),
    index("change_set_file_sha").on(table.accountId, table.sha256),
  ],
);

// work a write asked for, run after it commits: one row per subject, put off by each failed run;
// its payload is read through its kind's schema
export const job = pgTable.withRLS(
  "job",
  {
    accountId: accountId(),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: ms("created_at").notNull(),
    id: text("id").notNull(),
    kind: jobKind("kind").notNull(),
    payload: jsonb("payload").notNull(),
    runAt: ms("run_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.accountId, table.id] }),
    index("job_run_at").on(table.runAt),
  ],
);
