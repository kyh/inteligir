// What the cell answers an agent's reads with, inside one read transaction: the listing and a
// search's filters through the same in-memory index a replica keeps (`@repo/notes/library/
// library-index`), built over the cell's rows for the one call; an item as its markdown view,
// paged by block position and cut to a page an agent's tool result can carry; the folder tree and
// tags; highlights; and the change sets History shows. Times an agent reads are ISO 8601.

import type {
  changeSetSchema,
  highlightSchema,
  itemReadSchema,
  itemSummarySchema,
  searchHitSchema,
} from "@repo/contract/cloud/library/library-wire";
import { itemView, viewPage } from "@repo/editor/codec/item-view";
import type { ViewPage } from "@repo/editor/codec/item-view";
import { TYPED_QUERY } from "@repo/notes/knowledge/search-query";
import { bodyPrefilters, excerptAround, findTextOffsets } from "@repo/notes/knowledge/text-matches";
import type { ItemKind } from "@repo/notes/items/item-kind";
import { compareText } from "@repo/notes/library/block-order";
import { itemCardSchema } from "@repo/notes/library/derive-item";
import type { ItemCard } from "@repo/notes/library/derive-item";
import { LibraryIndex } from "@repo/notes/library/library-index";
import type { ListingRow } from "@repo/notes/library/library-index";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import { CHANGE_SET_ACTORS } from "@repo/notes/library/library-schema";
import {
  linksTo,
  linksToUrl,
  matchCandidates,
  readBlocks,
  readItem,
  searchLibrary,
} from "@repo/notes/library/library-queries";
import { chunkStatement, runPlan } from "@repo/notes/library/library-sql";
import type { SqlStatements } from "@repo/notes/library/library-sql";
import { z } from "zod";

import type { CellCodec } from "./cell-codec";
import { liveFolders } from "./cell-folders";
import { readFieldsPart } from "./cell-parts";
import { refuse } from "./cell-refusal";

type ItemSummary = z.infer<typeof itemSummarySchema>;
type SearchHit = z.infer<typeof searchHitSchema>;
type ItemRead = z.infer<typeof itemReadSchema>;
type Highlight = z.infer<typeof highlightSchema>;
type ChangeSet = z.infer<typeof changeSetSchema>;

export type ResponseFormat = "concise" | "detailed";

export const isoOf = (ms: number): string => new Date(ms).toISOString();

const JSON_TEXT = z.string().transform((text, context) => {
  try {
    return z.json().parse(JSON.parse(text));
  } catch {
    context.addIssue({ code: "custom", message: "is not JSON" });
    return z.NEVER;
  }
});

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

interface ItemListing extends ListingRow {
  readonly card: ItemCard;
  readonly site: string | null;
  // the tags its field holds, which an answer names; `tags` holds its body's too
  readonly fieldTags: readonly string[];
}

const listingRowSchema = z.object({
  card: z.string(),
  deleted_at: z.number().nullable(),
  folder_id: z.string().nullable(),
  id: z.string(),
  kind: z.enum(["note", "link", "video", "audio", "image", "pdf", "file"]),
  pinned_at: z.number().nullable(),
  saved_at: z.number(),
  site: z.string().nullable(),
  tags: z.string(),
  updated_at: z.number(),
  url: z.string().nullable(),
});
const tagRowSchema = z.object({ item_id: z.string(), tag: z.string() });
const namesSchema = z.array(z.string());

// every item the library holds (none purged), with the folders a listing files them under
const listingOf = (sql: SqlStatements): LibraryIndex<ItemListing> => {
  const tags = new Map<string, string[]>();
  for (const raw of sql.all("SELECT item_id, tag FROM item_tags ORDER BY item_id, tag", [])) {
    const row = tagRowSchema.parse(raw);
    const held = tags.get(row.item_id) ?? [];
    if (!held.includes(row.tag)) {
      held.push(row.tag);
    }
    tags.set(row.item_id, held);
  }
  const index = new LibraryIndex<ItemListing>();
  for (const raw of sql.all(
    `SELECT id, kind, card, folder_id, tags, url, site, saved_at, updated_at, pinned_at, deleted_at
     FROM items WHERE purged = 0`,
    [],
  )) {
    const row = listingRowSchema.parse(raw);
    const card = JSON_TEXT.pipe(itemCardSchema).parse(row.card);
    index.upsert({
      card,
      deletedAt: row.deleted_at,
      fieldTags: JSON_TEXT.pipe(namesSchema).parse(row.tags),
      folderId: row.folder_id,
      id: row.id,
      kind: row.kind,
      pinnedAt: row.pinned_at,
      savedAt: row.saved_at,
      site: row.site,
      tags: tags.get(row.id) ?? [],
      title: card.title,
      updatedAt: row.updated_at,
      url: row.url,
    });
  }
  index.setFolders(liveFolders(sql));
  return index;
};

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
        site: row.site,
        tags: row.fieldTags,
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

// how many hits a search ranks before its filters, and how much of a hit's text a concise answer
// keeps
const SEARCH_CANDIDATES = 200;
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

// the ranked index first, then the items holding the query's exact text the index's words miss
// (a part of a word, punctuation), found by an instr() scan an ascii prefilter narrows
const searchHits = (sql: SqlStatements, query: string): Map<string, string> => {
  const hits = new Map<string, string>();
  for (const hit of runPlan(sql, searchLibrary(query, SEARCH_CANDIDATES, TYPED_QUERY))) {
    hits.set(hit.itemId, hit.snippet);
  }
  const prefilters = bodyPrefilters([query]);
  if (hits.size >= SEARCH_CANDIDATES || prefilters === null) {
    return hits;
  }
  for (const text of runPlan(sql, matchCandidates(prefilters))) {
    if (hits.size >= SEARCH_CANDIDATES || hits.has(text.itemId)) {
      continue;
    }
    for (const line of text.body.split("\n")) {
      const [match] = findTextOffsets(line, query, { caseSensitive: false, wholeWord: false });
      if (match !== undefined) {
        const excerpt = excerptAround(line, {
          column: match.offset,
          length: match.length,
          line: 1,
        });
        hits.set(text.itemId, `${excerpt.before}${excerpt.text}${excerpt.after}`);
        break;
      }
    }
  }
  return hits;
};

export const searchItems = (sql: SqlStatements, input: SearchInput) => {
  const offset = offsetOf(input.cursor);
  const hits = searchHits(sql, input.query);
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
      found.push({ id: row.id, title: JSON_TEXT.pipe(itemCardSchema).parse(row.card).title });
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
  const sources = [
    ...runPlan(sql, linksTo(input.id)),
    ...(item.urlKey === null ? [] : runPlan(sql, linksToUrl(item.urlKey))),
  ];
  const into = new Set(sources.map((link) => link.sourceId).filter((id) => id !== input.id));
  const [counted] = sql.all(
    `SELECT count(*) AS count FROM annotations
     WHERE item_id = ? AND parent_id IS NULL AND deleted_at IS NULL`,
    [input.id],
  );
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
    highlights: countRowSchema.parse(counted).count,
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

// ---- highlights ----

const highlightRowSchema = z.object({
  card: z.string(),
  created_at: z.number(),
  id: z.string(),
  item_id: z.string(),
  quote: z.string().nullable(),
  text: z.string(),
});
const replyRowSchema = z.object({
  created_at: z.number(),
  id: z.string(),
  parent_id: z.string(),
  text: z.string(),
});

export interface HighlightsInput {
  readonly cursor?: string | undefined;
  readonly itemId?: string | undefined;
  readonly limit: number;
  // a date, from whose start on highlights are listed
  readonly since?: string | undefined;
}

// whether the highlight's markers stand in its item's text: a block anchors it
const isPlaced = (sql: SqlStatements, itemId: string, id: string): boolean =>
  sql.all("SELECT 1 FROM blocks WHERE item_id = ? AND instr(annotation_ids, ?) > 0 LIMIT 1", [
    itemId,
    JSON.stringify(id),
  ]).length > 0;

// a highlight's times are unix seconds, as its row keeps them
const isoOfSeconds = (seconds: number): string => isoOf(seconds * 1000);

export const listHighlights = (sql: SqlStatements, input: HighlightsInput) => {
  const offset = offsetOf(input.cursor);
  const where = [
    "a.parent_id IS NULL",
    "a.deleted_at IS NULL",
    "items.purged = 0",
    "items.deleted_at IS NULL",
    ...(input.itemId === undefined ? [] : ["a.item_id = ?"]),
    ...(input.since === undefined ? [] : ["a.created_at >= ?"]),
  ];
  const params = [
    ...(input.itemId === undefined ? [] : [input.itemId]),
    ...(input.since === undefined ? [] : [Math.floor(Date.parse(input.since) / 1000)]),
  ];
  const rows = sql
    .all(
      `SELECT a.id AS id, a.item_id AS item_id, a.quote AS quote, a.text AS text,
         a.created_at AS created_at, items.card AS card
       FROM annotations a JOIN items ON items.id = a.item_id
       WHERE ${where.join(" AND ")}
       ORDER BY a.created_at DESC, a.id DESC LIMIT ? OFFSET ?`,
      [...params, input.limit + 1, offset],
    )
    .map((row) => highlightRowSchema.parse(row));
  const shown = rows.slice(0, input.limit);
  const replies = new Map<string, Highlight["replies"][number][]>();
  for (const statement of chunkStatement({
    each: "?",
    head: `SELECT id, parent_id, text, created_at FROM annotations
      WHERE deleted_at IS NULL AND parent_id IN (`,
    rows: shown.map((row) => [row.id]),
    separator: ", ",
    tail: ") ORDER BY created_at, id",
  })) {
    for (const raw of sql.all(statement.sql, statement.params)) {
      const reply = replyRowSchema.parse(raw);
      const held = replies.get(reply.parent_id) ?? [];
      held.push({ createdAt: isoOfSeconds(reply.created_at), id: reply.id, text: reply.text });
      replies.set(reply.parent_id, held);
    }
  }
  return {
    cursor: rows.length > input.limit ? String(offset + input.limit) : null,
    highlights: shown.map((row): Highlight => ({
      createdAt: isoOfSeconds(row.created_at),
      id: row.id,
      itemId: row.item_id,
      itemTitle: JSON_TEXT.pipe(itemCardSchema).parse(row.card).title,
      placed: isPlaced(sql, row.item_id, row.id),
      quote: row.quote,
      replies: replies.get(row.id) ?? [],
      text: row.text,
    })),
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
  undone_by: z.string().nullable(),
});
const setItemSchema = z.object({
  after_fields: z.string().nullable(),
  before_fields: z.string().nullable(),
  created: z.number(),
  item_id: z.string(),
});
const revRowSchema = z.object({ rev: z.number().nullable() });

const setItemOf = (sql: SqlStatements, setId: string, raw: z.infer<typeof setItemSchema>) => {
  const now = runPlan(sql, readItem(raw.item_id));
  const before =
    raw.before_fields === null ? null : readFieldsPart(sql, raw.item_id, raw.before_fields);
  // a set still open has written no after: the item is as it left it
  let after: LibraryItemFields | null = now?.kind === "live" ? now.fields : null;
  if (raw.after_fields !== null) {
    after = readFieldsPart(sql, raw.item_id, raw.after_fields);
  }
  const [rev] = sql.all(
    "SELECT max(rev) AS rev FROM revisions WHERE item_id = ? AND change_set_id = ?",
    [raw.item_id, setId],
  );
  return {
    created: raw.created === 1,
    deleted:
      after !== null && after.deletedAt !== null && (before === null || before.deletedAt === null),
    id: raw.item_id,
    rev: revRowSchema.parse(rev).rev,
    title: now?.kind === "live" ? now.card.title : (after?.title ?? before?.title ?? ""),
  };
};

export interface HistoryInput {
  readonly cursor?: string | undefined;
  readonly itemId?: string | undefined;
  readonly limit: number;
}

export const listHistory = (sql: SqlStatements, input: HistoryInput) => {
  const offset = offsetOf(input.cursor);
  const sets = sql
    .all(
      `SELECT id, actor, label, opened_at, sealed_at, undone_by FROM change_sets
       ${input.itemId === undefined ? "" : "WHERE id IN (SELECT change_set_id FROM change_set_items WHERE item_id = ?)"}
       ORDER BY opened_at DESC, id DESC LIMIT ? OFFSET ?`,
      [...(input.itemId === undefined ? [] : [input.itemId]), input.limit + 1, offset],
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
        .map((row) => setItemOf(sql, set.id, setItemSchema.parse(row)));
      return {
        actor: set.actor,
        closedAt: set.sealed_at === null ? null : isoOf(set.sealed_at),
        id: set.id,
        itemCount: countRowSchema.parse(counted).count,
        items,
        label: set.label,
        openedAt: isoOf(set.opened_at),
        undoneBy: set.undone_by,
      };
    }),
    cursor: sets.length > input.limit ? String(offset + input.limit) : null,
  };
};
