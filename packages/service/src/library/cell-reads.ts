// What the cell answers an agent's reads with, inside one read transaction: the listing and a
// search's filters through the cell's listing (`./cell-listing`); an item as its markdown view,
// paged by block position and cut to a page an agent's tool result can carry; the folder tree and
// tags; and the change sets Undo takes back. Times an agent reads are ISO 8601.

import type {
  changeSetSchema,
  itemReadSchema,
  itemSummarySchema,
  searchHitSchema,
} from "@repo/contract/library/library-wire";
import { itemView, viewPage } from "@repo/editor/codec/item-view";
import type { ViewPage } from "@repo/editor/codec/item-view";
import type { ItemKind } from "@repo/contract/items/item-kind";
import { compareText } from "@repo/contract/library/order-key";
import { itemCardSchema } from "@repo/contract/library/derive-item";
import type { BodyBlock, ItemCard } from "@repo/contract/library/derive-item";
import type { LibraryIndex, ListingRow } from "@repo/contract/library/library-index";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { linksTo, linksToUrl, readItem } from "./library-queries";
import { jsonTextSchema } from "./sql-value";
import {
  and,
  asc,
  countDistinct,
  desc,
  eq,
  getColumns,
  inArray,
  isNotNull,
  isNull,
} from "drizzle-orm";
import type { z } from "zod";

import { changeSetItems, changeSets, items, itemTags, links } from "@repo/db/cell/schema";
import type { CellCodec } from "./cell-codec";
import { listChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import { liveFolders } from "./cell-folders";
import { listedWhole, searchHits } from "./cell-listing";
import { readFieldsPart } from "./cell-parts";
import { refuse } from "./cell-refusal";
import type { CellStorage } from "./cell-storage";

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

export const listItems = (db: CellDb, listing: LibraryIndex<ListingRow>, input: ListInput) => {
  const offset = offsetOf(input.cursor);
  const page = listing.items({
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
    items: shown.map((row) => summaryOf(listedWhole(db, row.id), input.responseFormat)),
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

export const searchItems = (
  storage: CellStorage,
  listing: LibraryIndex<ListingRow>,
  input: SearchInput,
) => {
  const offset = offsetOf(input.cursor);
  const hits = searchHits(storage, input.query, "live");
  const page = listing.items({
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

// the live items of `ids`, by title
const linkedItems = (db: CellDb, ids: ReadonlySet<string>) => {
  const found: { id: string; title: string }[] = [];
  for (const chunk of listChunks([...ids])) {
    for (const row of db
      .select({ card: items.card, id: items.id })
      .from(items)
      .where(and(eq(items.purged, 0), isNull(items.deletedAt), inArray(items.id, chunk)))
      .all()) {
      found.push({ id: row.id, title: jsonTextSchema.pipe(itemCardSchema).parse(row.card).title });
    }
  }
  return found
    .toSorted((a, b) => compareText(a.title.toLowerCase(), b.title.toLowerCase()))
    .slice(0, READ_LINKS_MAX);
};

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

// the item's markdown from its body's blocks, read from where the body lives
export const readItemView = (
  storage: CellStorage,
  codec: CellCodec,
  input: ReadInput,
  blocks: readonly BodyBlock[],
): ItemRead => {
  const { db } = storage;
  const item = readItem(db, input.id);
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  const view = itemView(blocks, codec.view);
  const page = pageWithin(view, input.from ?? 0, input.count ?? READ_BLOCKS_DEFAULT);
  const out = new Set(
    db
      .selectDistinct({ targetId: links.targetId })
      .from(links)
      .where(and(eq(links.sourceId, input.id), isNotNull(links.targetId)))
      .all()
      .flatMap((row) => (row.targetId === null ? [] : [row.targetId])),
  );
  out.delete(input.id);
  const into = new Set([
    ...linksTo(db, input.id),
    ...(item.urlKey === null ? [] : linksToUrl(db, item.urlKey)),
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
    links: { in: linkedItems(db, into), out: linkedItems(db, out) },
    view: { from: page.from, markdown: page.markdown, to: page.to, total: page.total },
  };
};

// ---- the folder tree and tags ----

export const outlineOf = (db: CellDb, listing: LibraryIndex<ListingRow>) => {
  const counts = new Map(listing.scopes().folders.map((folder) => [folder.id, folder.items]));
  return {
    folders: liveFolders(db).map((folder) => ({
      id: folder.id,
      items: counts.get(folder.id) ?? 0,
      name: folder.name,
      parentId: folder.parentId,
    })),
    tags: db
      .select({ items: countDistinct(itemTags.itemId), tag: itemTags.tag })
      .from(itemTags)
      .innerJoin(items, eq(items.id, itemTags.itemId))
      .where(and(eq(items.purged, 0), isNull(items.deletedAt)))
      .groupBy(itemTags.tag)
      .orderBy(asc(itemTags.tag))
      .all(),
  };
};

// ---- change sets ----

// the items one set's entry names, at most a page of them
const SET_ITEMS_SHOWN = 50;

const SET_ITEM_COLUMNS = {
  afterFields: changeSetItems.afterFields,
  beforeFields: changeSetItems.beforeFields,
  created: changeSetItems.created,
  itemId: changeSetItems.itemId,
};

interface SetItemRow {
  readonly afterFields: string | null;
  readonly beforeFields: string | null;
  readonly created: number;
  readonly itemId: string;
}

const setItemOf = (db: CellDb, entry: SetItemRow) => {
  const now = readItem(db, entry.itemId);
  const before =
    entry.beforeFields === null ? null : readFieldsPart(db, entry.itemId, entry.beforeFields);
  // a set still open has written no after: the item is as it left it
  let after: LibraryItemFields | null = now?.kind === "live" ? now.fields : null;
  if (entry.afterFields !== null) {
    after = readFieldsPart(db, entry.itemId, entry.afterFields);
  }
  return {
    created: entry.created === 1,
    deleted:
      after !== null && after.deletedAt !== null && (before === null || before.deletedAt === null),
    id: entry.itemId,
    title: now?.kind === "live" ? now.card.title : (after?.title ?? before?.title ?? ""),
  };
};

interface ChangeSetsInput {
  readonly cursor?: string | undefined;
  // the sets one conversation's turns opened, which its Undo takes back; else the library's newest
  readonly threadId?: string | undefined;
  readonly limit: number;
}

export const listChangeSets = (db: CellDb, input: ChangeSetsInput) => {
  const offset = offsetOf(input.cursor);
  const sets = db
    .select({
      ...getColumns(changeSets),
      itemCount: db.$count(changeSetItems, eq(changeSetItems.changeSetId, changeSets.id)),
    })
    .from(changeSets)
    .where(input.threadId === undefined ? undefined : eq(changeSets.threadId, input.threadId))
    .orderBy(desc(changeSets.openedAt), desc(changeSets.id))
    .limit(input.limit + 1)
    .offset(offset)
    .all();
  const shown = sets.slice(0, input.limit);
  return {
    changeSets: shown.map((set): ChangeSet => {
      const setItems = db
        .select(SET_ITEM_COLUMNS)
        .from(changeSetItems)
        .where(eq(changeSetItems.changeSetId, set.id))
        .orderBy(asc(changeSetItems.itemId))
        .limit(SET_ITEMS_SHOWN)
        .all()
        .map((entry) => setItemOf(db, entry));
      return {
        actor: set.actor,
        closedAt: set.sealedAt === null ? null : isoOf(set.sealedAt),
        id: set.id,
        itemCount: set.itemCount,
        items: setItems,
        label: set.label,
        openedAt: isoOf(set.openedAt),
        threadId: set.threadId,
        turn: set.turn,
        undoneBy: set.undoneBy,
      };
    }),
    cursor: sets.length > input.limit ? String(offset + input.limit) : null,
  };
};
