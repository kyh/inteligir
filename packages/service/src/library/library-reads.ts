// What the library answers an agent's reads with: a list and a search through the listing
// (`./library-listing`), the folder tree and tags as the rail counts them, and an item as its
// markdown view, paged by block position and cut to a page an agent's tool result can carry. Times
// an agent reads are ISO 8601. An id the account holds no item under reads as none, which its row
// answers as NOT_FOUND.

import type { BodyBlock } from "@repo/contract/library/derive-item";
import { itemSummary } from "@repo/contract/library/library-index";
import type { ItemListing } from "@repo/contract/library/library-index";
import type {
  itemReadSchema,
  itemSummarySchema,
  searchHitSchema,
} from "@repo/contract/library/library-wire";
import { compareText } from "@repo/contract/library/order-key";
import type {
  listInputSchema,
  readInputSchema,
  searchInputSchema,
} from "@repo/contract/rpc/library-contract";
import type { DbExecutor } from "@repo/db/drizzle-client";
import { item, itemLink } from "@repo/db/library-schema";
import { viewPage } from "@repo/editor/headless/codec/item-view";
import type { ViewPage, ViewPorts } from "@repo/editor/headless/codec/item-view";
import { and, eq, exists, isNull, ne, or, sql } from "drizzle-orm";
import type { z } from "zod";

import { searchHits } from "../search/search-sql";
import { listingItems, listingScopes } from "./library-listing";
import { readItemWhole } from "./library-rows";
import type { StoredItem } from "./library-rows";

type ItemSummary = z.infer<typeof itemSummarySchema>;
type SearchHit = z.infer<typeof searchHitSchema>;
type ItemRead = z.infer<typeof itemReadSchema>;

const isoOf = (ms: number): string => new Date(ms).toISOString();

// the most of the markdown one page of a read carries: twice over (as text and as structured
// content) a page stays well inside what an agent's tool result may carry whole
const READ_PAGE_MAX_CHARS = 16_000;
// the items a read names as linking in or out, the first by title
const READ_LINKS_MAX = 50;

// the page the read asks for, halved until it fits; one block alone is its own page however long
const pageWithin = (
  blocks: readonly BodyBlock[],
  ports: ViewPorts,
  from: number,
  count: number,
): ViewPage => {
  let page = viewPage(blocks, ports, from, count);
  for (let asked = count; page.markdown.length > READ_PAGE_MAX_CHARS && asked > 1;) {
    asked = Math.max(1, Math.floor(asked / 2));
    page = viewPage(blocks, ports, from, asked);
  }
  return page;
};

interface Linked {
  readonly id: string;
  readonly title: string;
  readonly titleSort: string;
  readonly deletedAt: number | null;
}

const LINKED_COLUMNS = {
  deletedAt: item.deletedAt,
  id: item.id,
  title: sql<string>`${item.card}->>'title'`,
  titleSort: item.titleSort,
};

const byTitle = (a: Linked, b: Linked): number =>
  compareText(a.titleSort, b.titleSort) || compareText(a.id, b.id);

// the first live items of `linked` by title, the item itself aside
const shownLinks = (linked: readonly Linked[], self: string) =>
  linked
    .filter(({ deletedAt, id }) => deletedAt === null && id !== self)
    .toSorted(byTitle)
    .slice(0, READ_LINKS_MAX)
    .map(({ id, title }) => ({ id, title }));

// every item the body links to by id, in Deleted or not, which its rows name: a page link in the
// view is written under its item's title as it stands
const linkedFrom = async (db: DbExecutor, accountId: string, sourceId: string) =>
  await db
    .select(LINKED_COLUMNS)
    .from(item)
    .where(
      and(
        eq(item.accountId, accountId),
        exists(
          db
            .select({ held: sql`1` })
            .from(itemLink)
            .where(
              and(
                eq(itemLink.accountId, item.accountId),
                eq(itemLink.sourceId, sourceId),
                eq(itemLink.targetId, item.id),
              ),
            ),
        ),
      ),
    );

// the live items linking to the item, by its id or by its address
const linkingTo = async (db: DbExecutor, accountId: string, target: StoredItem) =>
  await db
    .select(LINKED_COLUMNS)
    .from(item)
    .where(
      and(
        eq(item.accountId, accountId),
        isNull(item.deletedAt),
        ne(item.id, target.id),
        exists(
          db
            .select({ held: sql`1` })
            .from(itemLink)
            .where(
              and(
                eq(itemLink.accountId, item.accountId),
                eq(itemLink.sourceId, item.id),
                or(
                  eq(itemLink.targetId, target.id),
                  target.urlKey === null ? undefined : eq(itemLink.targetKey, target.urlKey),
                ),
              ),
            ),
        ),
      ),
    );

// where its page reading stands, its times as instants
const readingOf = (reading: StoredItem["fields"]["reading"]): ItemRead["fields"]["reading"] => {
  switch (reading.state) {
    case "none": {
      return reading;
    }
    case "pending": {
      return { at: reading.at === null ? null : isoOf(reading.at), state: reading.state };
    }
    case "read": {
      return { at: isoOf(reading.at), state: reading.state };
    }
    case "failed": {
      return {
        at: reading.at === null ? null : isoOf(reading.at),
        error: reading.error,
        state: reading.state,
      };
    }
    // no default
  }
};

// the item's markdown from its body's blocks, a page of them, beside the items it links with
export const readItemView = async (
  db: DbExecutor,
  accountId: string,
  input: z.output<typeof readInputSchema>,
): Promise<ItemRead | null> => {
  const whole = await readItemWhole(db, accountId, input.id);
  if (whole === null) {
    return null;
  }
  const { blocks, item: stored } = whole;
  const out = await linkedFrom(db, accountId, input.id);
  const titles = new Map(out.map(({ id, title }) => [id, title]));
  const page = pageWithin(
    blocks,
    { title: (id) => titles.get(id) ?? null },
    input.from,
    input.count,
  );
  const into = await linkingTo(db, accountId, stored);
  const { fields } = stored;
  const detailed = input.responseFormat === "detailed";
  return {
    fields: {
      aliases: detailed ? fields.aliases : undefined,
      author: fields.author,
      deletedAt: fields.deletedAt === null ? null : isoOf(fields.deletedAt),
      description: fields.description,
      folderId: fields.folderId,
      kind: fields.kind,
      pinned: fields.pinnedAt !== null,
      properties: detailed ? fields.properties : undefined,
      published: fields.published,
      reading: readingOf(fields.reading),
      savedAt: isoOf(fields.savedAt),
      site: fields.site,
      tags: fields.tags,
      title: stored.card.title,
      url: fields.url,
    },
    id: input.id,
    links: { in: shownLinks(into, input.id), out: shownLinks(out, input.id) },
    view: { from: page.from, markdown: page.markdown, to: page.to, total: page.total },
  };
};

// ---- an agent's lists ----

// an item as a list names it in detail: its summary, and what a person reads on its card
const detailedSummary = (row: ItemListing): ItemSummary => ({
  ...itemSummary(row),
  preview: row.card.preview,
  site: row.fields.site,
});

export const listItems = async (
  db: DbExecutor,
  accountId: string,
  input: z.output<typeof listInputSchema>,
) => {
  const page = await listingItems(db, accountId, {
    deleted: false,
    folderId: input.folderId,
    kinds: input.kinds,
    limit: input.limit,
    offset: input.cursor,
    order: { by: input.sort },
    pinned: input.pinned,
    tag: input.tag,
  });
  return {
    cursor: page.next,
    items: page.items.map((row) =>
      input.responseFormat === "detailed" ? detailedSummary(row) : itemSummary(row),
    ),
  };
};

// how much of a hit's text a concise answer keeps
const CONCISE_SNIPPET_CHARS = 160;

const DAY_MS = 24 * 60 * 60 * 1000;

export const searchItems = async (
  db: DbExecutor,
  accountId: string,
  input: z.output<typeof searchInputSchema>,
) => {
  const hits = await searchHits(db, accountId, input.query, "live");
  const page = await listingItems(db, accountId, {
    beforeMs: input.savedBefore === undefined ? undefined : Date.parse(input.savedBefore) + DAY_MS,
    deleted: false,
    folderId: input.folderId,
    kinds: input.kinds,
    limit: input.limit,
    offset: input.cursor,
    order: { by: "rank", rank: hits.rank },
    sinceMs: input.savedAfter === undefined ? undefined : Date.parse(input.savedAfter),
    tag: input.tag,
  });
  const passages = await hits.passages(page.items);
  return {
    cursor: page.next,
    hits: page.items.map((row): SearchHit => {
      const snippet = passages.get(row.id) ?? row.title;
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

// the folder tree and every tag as the rail counts them, a folder's order key left out
export const libraryOutline = async (db: DbExecutor, accountId: string) => {
  const { folders, tags } = await listingScopes(db, accountId);
  return {
    folders: folders.map(({ id, items, name, parentId }) => ({ id, items, name, parentId })),
    tags,
  };
};
