// What the cell answers an agent's reads with, inside one read transaction, each from its row's
// input as the contract parsed it: a list and a search through the cell's listing
// (`./cell-listing`); and an item as its markdown view, paged by block position and cut to a page
// an agent's tool result can carry. Times an agent reads are ISO 8601.

import type {
  listInputSchema,
  readInputSchema,
  searchInputSchema,
} from "@repo/contract/library/library-contract";
import type {
  itemReadSchema,
  itemSummarySchema,
  searchHitSchema,
} from "@repo/contract/library/library-wire";
import { viewPage } from "@repo/editor/codec/item-view";
import type { ViewPage, ViewPorts } from "@repo/editor/codec/item-view";
import { compareText } from "@repo/contract/library/order-key";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { itemListing, itemSummary } from "@repo/contract/library/library-index";
import type { ItemListing, LibraryIndex, ListingRow } from "@repo/contract/library/library-index";
import { cardTitle, linksTo, linksToUrl, readItem } from "./library-queries";
import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import type { z } from "zod";

import { items, itemTags, links } from "@repo/db/cell/schema";
import type { CellCodec } from "./cell-codec";
import { listChunks } from "./cell-db";
import type { CellDb } from "./cell-db";
import type { LiveItemRow } from "./cell-landing";
import { searchHits } from "../search/search-hits";
import { listedWhole, tagsOf } from "./cell-listing";
import { refuse } from "./cell-refusal";

type ItemSummary = z.infer<typeof itemSummarySchema>;
type SearchHit = z.infer<typeof searchHitSchema>;
type ItemRead = z.infer<typeof itemReadSchema>;

const isoOf = (ms: number): string => new Date(ms).toISOString();

// ---- the listing ----

// an item as a list names it in detail: its summary, and what a person reads on its card
const detailedSummary = (item: ItemListing): ItemSummary => ({
  ...itemSummary(item),
  preview: item.card.preview,
  site: item.fields.site,
});

export const listItems = (
  db: CellDb,
  listing: LibraryIndex<ListingRow>,
  input: z.output<typeof listInputSchema>,
) => {
  const page = listing.items({
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
      input.responseFormat === "detailed"
        ? detailedSummary(itemListing(listedWhole(db, row.id), row.tags))
        : itemSummary(row),
    ),
  };
};

// the items a write landed as a list names them, each with every tag it carries as the write
// left it, so an organize and a list answer one spelling of an item
export const landedSummaries = (db: CellDb, rows: readonly LiveItemRow[]): ItemSummary[] => {
  const tags = new Map(
    listChunks(rows.map(({ id }) => id)).flatMap((ids) => [
      ...tagsOf(db, inArray(itemTags.itemId, ids)),
    ]),
  );
  return rows.map((row) => itemSummary(itemListing(row, tags.get(row.id) ?? [])));
};

// ---- search ----

// how much of a hit's text a concise answer keeps
const CONCISE_SNIPPET_CHARS = 160;

const DAY_MS = 24 * 60 * 60 * 1000;

export const searchItems = (
  db: CellDb,
  listing: LibraryIndex<ListingRow>,
  input: z.output<typeof searchInputSchema>,
) => {
  const hits = searchHits(db, input.query, "live");
  const page = listing.items({
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
  return {
    cursor: page.next,
    hits: page.items.map((row): SearchHit => {
      const snippet = hits.passage(row.id) ?? row.title;
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

// the most of the markdown one page of a read carries: twice over (as text and as structured
// content) a page stays well inside what an agent's tool result may carry whole
const READ_PAGE_MAX_CHARS = 16_000;
// the items a read names as linking in or out, the first by title
const READ_LINKS_MAX = 50;

// the live items of `ids`, by title
const linkedItems = (db: CellDb, ids: ReadonlySet<string>) =>
  listChunks([...ids])
    .flatMap((chunk) =>
      db
        .select({ id: items.id, title: cardTitle })
        .from(items)
        .where(and(isNull(items.deletedAt), inArray(items.id, chunk)))
        .all(),
    )
    .toSorted((a, b) => compareText(a.title.toLowerCase(), b.title.toLowerCase()))
    .slice(0, READ_LINKS_MAX);

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

// the item's markdown from its body's blocks, read from where the body lives
export const readItemView = (
  db: CellDb,
  codec: CellCodec,
  input: z.output<typeof readInputSchema>,
  blocks: readonly BodyBlock[],
): ItemRead => {
  const item = readItem(db, input.id);
  if (item === null) {
    return refuse({ kind: "not-found" });
  }
  const page = pageWithin(blocks, codec.view, input.from, input.count);
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
  const { reading } = fields;
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
      reading:
        reading.state === "none"
          ? reading
          : { ...reading, at: reading.at === null ? null : isoOf(reading.at) },
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
