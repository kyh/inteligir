// What the cell answers an agent's reads with, inside one read transaction: the listing and a
// search's filters through the cell's listing (`./cell-listing`); an item as its markdown view,
// paged by block position and cut to a page an agent's tool result can carry; the folder tree and
// tags; and the change sets Undo takes back. Times an agent reads are ISO 8601.

import type {
  changeSetSchema,
  itemReadSchema,
  itemSummarySchema,
  searchHitSchema,
} from "@repo/contract/cloud/library/library-wire";
import { itemView, viewPage } from "@repo/editor/codec/item-view";
import type { ViewPage } from "@repo/editor/codec/item-view";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { compareText } from "@repo/notes/library/block-order";
import { itemCardSchema } from "@repo/notes/library/derive-item";
import type { ItemCard } from "@repo/notes/library/derive-item";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { CHANGE_SET_ACTORS } from "@repo/notes/library/library-schema";
import { linksTo, linksToUrl, readBlocks, readItem } from "@repo/notes/library/library-queries";
import { chunkStatement, runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { jsonTextSchema } from "@repo/notes/library/sql-value";
import { z } from "zod";

import type { CellCodec } from "./cell-codec";
import { liveFolders } from "./cell-folders";
import { listingOf, searchHits } from "./cell-listing";
import type { ItemListing } from "./cell-listing";
import { readFieldsPart } from "./cell-parts";
import { refuse } from "./cell-refusal";

type ItemSummary = z.infer<typeof itemSummarySchema>;
type SearchHit = z.infer<typeof searchHitSchema>;
type ItemRead = z.infer<typeof itemReadSchema>;
type ChangeSet = z.infer<typeof changeSetSchema>;

export type ResponseFormat = "concise" | "detailed";

const isoOf = (ms: number): string => new Date(ms).toISOString();

// ---- pages ----

// a page's place in an answer: the rows from `offset`, and the cursor the next page starts at
const CURSOR = /^(?:0|[1-9]\d{0,8})$/u;

export const offsetOf = (cursor: string | undefined): number => {
  if (cursor === undefined) {
    return 0;
  }
  return CURSOR.test(cursor) ? Number(cursor) : refuse({ kind: "bad-cursor" });
};

const nextCursor = (offset: number, shown: number, total: number): string | null =>
  offset + shown < total ? String(offset + shown) : null;

// ---- the listing ----

// an item as a list names it: ids and names, and in detail what a person reads on its card
export const summaryOf = (
  item: {
    readonly id: string;
    readonly card: ItemCard;
    readonly fields: Pick<
      LibraryItemFields,
      "folderId" | "kind" | "pinnedAt" | "savedAt" | "site" | "url"
    > & { readonly tags: readonly string[] };
  },
  format: ResponseFormat,
): ItemSummary => {
  const { fields } = item;
  const detailed = format === "detailed";
  return {
    folderId: fields.folderId,
    id: item.id,
    kind: fields.kind,
    pinned: fields.pinnedAt !== null,
    preview: detailed ? item.card.preview : undefined,
    savedAt: isoOf(fields.savedAt),
    site: detailed ? fields.site : undefined,
    tags: [...fields.tags],
    title: item.card.title,
    url: fields.url,
  };
};

const summaryOfListing = (row: ItemListing, format: ResponseFormat): ItemSummary =>
  summaryOf(
    {
      card: row.card,
      fields: {
        folderId: row.folderId,
        kind: row.kind,
        pinnedAt: row.pinnedAt,
        savedAt: row.savedAt,
        site: row.fields.site,
        tags: row.fields.tags,
        url: row.url,
      },
      id: row.id,
    },
    format,
  );

const LIST_SORTS = { saved: "saved", title: "title", updated: "modified" } as const;

export interface ListInput {
  readonly cursor?: string | undefined;
  readonly folderId?: string | undefined;
  readonly kind?: ItemKind | undefined;
  readonly limit: number;
  readonly pinned?: boolean | undefined;
  readonly responseFormat: ResponseFormat;
  readonly sort?: keyof typeof LIST_SORTS | undefined;
  readonly tag?: string | undefined;
}

export const listItems = (sql: SqlStatements, input: ListInput) => {
  const offset = offsetOf(input.cursor);
  const index = listingOf(sql);
  const page = index.items({
    deleted: false,
    folderId: input.folderId,
    kinds: input.kind === undefined ? undefined : [input.kind],
    limit: Number.MAX_SAFE_INTEGER,
    offset: 0,
    sort: LIST_SORTS[input.sort ?? "saved"],
    subfolders: true,
    tag: input.tag,
  });
  const rows =
    input.pinned === undefined
      ? page.items
      : page.items.filter((row) => (row.pinnedAt !== null) === input.pinned);
  const shown = rows.slice(offset, offset + input.limit);
  return {
    cursor: nextCursor(offset, shown.length, rows.length),
    items: shown.map((row) => summaryOfListing(row, input.responseFormat)),
  };
};

// ---- search ----

// how much of a hit's text a concise answer keeps
const CONCISE_SNIPPET_CHARS = 160;

export interface SearchInput {
  readonly query: string;
  readonly cursor?: string | undefined;
  readonly folderId?: string | undefined;
  readonly kinds?: readonly ItemKind[] | undefined;
  readonly limit: number;
  readonly responseFormat: ResponseFormat;
  readonly savedAfter?: string | undefined;
  readonly savedBefore?: string | undefined;
  readonly tag?: string | undefined;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const searchItems = (sql: SqlStatements, input: SearchInput) => {
  const offset = offsetOf(input.cursor);
  const hits = searchHits(sql, input.query, "live");
  const page = listingOf(sql).items({
    beforeMs: input.savedBefore === undefined ? undefined : Date.parse(input.savedBefore) + DAY_MS,
    deleted: false,
    folderId: input.folderId,
    kinds: input.kinds,
    limit: input.limit,
    offset,
    sinceMs: input.savedAfter === undefined ? undefined : Date.parse(input.savedAfter),
    sort: "relevance",
    subfolders: true,
    tag: input.tag,
    within: new Map([...hits.keys()].map((id, rank) => [id, rank])),
  });
  return {
    cursor: nextCursor(offset, page.items.length, page.total),
    hits: page.items.map((row): SearchHit => {
      const snippet = hits.get(row.id) ?? row.title;
      return {
        id: row.id,
        kind: row.kind,
        savedAt: isoOf(row.savedAt),
        snippet:
          input.responseFormat === "concise" ? snippet.slice(0, CONCISE_SNIPPET_CHARS) : snippet,
        title: row.title,
        url: row.url,
      };
    }),
  };
};

// ---- an item ----

// the blocks a read takes unless it asks, and the most of the markdown one page carries: twice
// over (as text and as structured content) a page stays well inside what an agent's tool result
// may carry whole
const READ_BLOCKS_DEFAULT = 200;
const READ_PAGE_MAX_CHARS = 16_000;
// the items a read names as linking in or out, the first by title
const READ_LINKS_MAX = 50;

const titleRowSchema = z.object({ card: z.string(), id: z.string() });

// the live items of `ids`, by title
const linkedItems = (sql: SqlStatements, ids: ReadonlySet<string>) => {
  const found: { id: string; title: string }[] = [];
  for (const statement of chunkStatement({
    each: "?",
    head: "SELECT id, card FROM items WHERE purged = 0 AND deleted_at IS NULL AND id IN (",
    rows: [...ids].map((id) => [id]),
    separator: ", ",
    tail: ")",
  })) {
    for (const raw of sql.all(statement.sql, statement.params)) {
      const row = titleRowSchema.parse(raw);
      found.push({ id: row.id, title: jsonTextSchema.pipe(itemCardSchema).parse(row.card).title });
    }
  }
  return found
    .toSorted((a, b) => compareText(a.title.toLowerCase(), b.title.toLowerCase()))
    .slice(0, READ_LINKS_MAX);
};

const targetRowSchema = z.object({ target_id: z.string() });
const countRowSchema = z.object({ count: z.number() });

// the page the read asks for, halved until it fits; one block alone is its own page however long
const pageWithin = (view: ReturnType<typeof itemView>, from: number, count: number): ViewPage => {
  let page = viewPage(view, from, count);
  for (let asked = count; page.markdown.length > READ_PAGE_MAX_CHARS && asked > 1;) {
    asked = Math.max(1, Math.floor(asked / 2));
    page = viewPage(view, from, asked);
  }
  return page;
};

export interface ReadInput {
  readonly id: string;
  readonly from?: number | undefined;
  readonly count?: number | undefined;
  readonly responseFormat: ResponseFormat;
}

export const readItemView = (sql: SqlStatements, codec: CellCodec, input: ReadInput): ItemRead => {
  const item = runPlan(sql, readItem(input.id));
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  const blocks = runPlan(sql, readBlocks(input.id));
  const view = itemView(new Map(blocks.map((stored) => [stored.block.id, stored])), codec.view);
  const page = pageWithin(view, input.from ?? 0, input.count ?? READ_BLOCKS_DEFAULT);
  const out = new Set(
    sql
      .all("SELECT DISTINCT target_id FROM links WHERE source_id = ? AND target_id IS NOT NULL", [
        input.id,
      ])
      .map((row) => targetRowSchema.parse(row).target_id),
  );
  out.delete(input.id);
  const into = new Set([
    ...runPlan(sql, linksTo(input.id)),
    ...(item.urlKey === null ? [] : runPlan(sql, linksToUrl(item.urlKey))),
  ]);
  into.delete(input.id);
  const { fields } = item;
  const detailed = input.responseFormat === "detailed";
  return {
    fields: {
      aliases: detailed ? fields.aliases : undefined,
      author: fields.author,
      deletedAt: fields.deletedAt === null ? null : isoOf(fields.deletedAt),
      description: fields.description,
      fetchError: fields.fetchError,
      fetchState: fields.fetchState,
      folderId: fields.folderId,
      kind: fields.kind,
      pinned: fields.pinnedAt !== null,
      properties: detailed ? fields.properties : undefined,
      published: fields.published,
      savedAt: isoOf(fields.savedAt),
      site: fields.site,
      tags: fields.tags,
      title: item.card.title,
      url: fields.url,
    },
    id: input.id,
    links: { in: linkedItems(sql, into), out: linkedItems(sql, out) },
    seq: item.seq,
    view: { from: page.from, markdown: page.markdown, to: page.to, total: page.total },
  };
};

// ---- the folder tree and tags ----

const tagCountSchema = z.object({ items: z.number(), tag: z.string() });

export const outlineOf = (sql: SqlStatements) => {
  const counts = new Map(
    listingOf(sql)
      .scopes()
      .folders.map((folder) => [folder.id, folder.items]),
  );
  return {
    folders: liveFolders(sql).map((folder) => ({
      id: folder.id,
      items: counts.get(folder.id) ?? 0,
      name: folder.name,
      parentId: folder.parentId,
    })),
    tags: sql
      .all(
        `SELECT item_tags.tag AS tag, count(DISTINCT item_tags.item_id) AS items FROM item_tags
         JOIN items ON items.id = item_tags.item_id
         WHERE items.purged = 0 AND items.deleted_at IS NULL
         GROUP BY item_tags.tag ORDER BY item_tags.tag`,
        [],
      )
      .map((row) => tagCountSchema.parse(row)),
  };
};

// ---- history ----

// the items one set's entry names, at most a page of them
const SET_ITEMS_SHOWN = 50;

const setRowSchema = z.object({
  actor: z.enum(CHANGE_SET_ACTORS),
  id: z.string(),
  label: z.string(),
  opened_at: z.number(),
  sealed_at: z.number().nullable(),
  thread_id: z.string().nullable(),
  turn: z.number().int().positive().nullable(),
  undone_by: z.string().nullable(),
});
const setItemSchema = z.object({
  after_fields: z.string().nullable(),
  before_fields: z.string().nullable(),
  created: z.number(),
  item_id: z.string(),
});

const setItemOf = (sql: SqlStatements, raw: z.infer<typeof setItemSchema>) => {
  const now = runPlan(sql, readItem(raw.item_id));
  const before =
    raw.before_fields === null ? null : readFieldsPart(sql, raw.item_id, raw.before_fields);
  // a set still open has written no after: the item is as it left it
  let after: LibraryItemFields | null = now?.kind === "live" ? now.fields : null;
  if (raw.after_fields !== null) {
    after = readFieldsPart(sql, raw.item_id, raw.after_fields);
  }
  return {
    created: raw.created === 1,
    deleted:
      after !== null && after.deletedAt !== null && (before === null || before.deletedAt === null),
    id: raw.item_id,
    title: now?.kind === "live" ? now.card.title : (after?.title ?? before?.title ?? ""),
  };
};

interface HistoryInput {
  readonly cursor?: string | undefined;
  // the sets one conversation's turns opened, which its Undo takes back; else the library's newest
  readonly threadId?: string | undefined;
  readonly limit: number;
}

export const listHistory = (sql: SqlStatements, input: HistoryInput) => {
  const offset = offsetOf(input.cursor);
  const threadId = input.threadId ?? null;
  const sets = sql
    .all(
      `SELECT id, actor, label, opened_at, sealed_at, thread_id, turn, undone_by FROM change_sets
       WHERE ? IS NULL OR thread_id = ?
       ORDER BY opened_at DESC, id DESC LIMIT ? OFFSET ?`,
      [threadId, threadId, input.limit + 1, offset],
    )
    .map((row) => setRowSchema.parse(row));
  const shown = sets.slice(0, input.limit);
  return {
    changeSets: shown.map((set): ChangeSet => {
      const [counted] = sql.all(
        "SELECT count(*) AS count FROM change_set_items WHERE change_set_id = ?",
        [set.id],
      );
      const items = sql
        .all(
          `SELECT item_id, created, before_fields, after_fields FROM change_set_items
           WHERE change_set_id = ? ORDER BY item_id LIMIT ?`,
          [set.id, SET_ITEMS_SHOWN],
        )
        .map((row) => setItemOf(sql, setItemSchema.parse(row)));
      return {
        actor: set.actor,
        closedAt: set.sealed_at === null ? null : isoOf(set.sealed_at),
        id: set.id,
        itemCount: countRowSchema.parse(counted).count,
        items,
        label: set.label,
        openedAt: isoOf(set.opened_at),
        threadId: set.thread_id,
        turn: set.turn,
        undoneBy: set.undone_by,
      };
    }),
    cursor: sets.length > input.limit ? String(offset + input.limit) : null,
  };
};
