// What the apps read of the library, inside one read transaction: an item whole, and the listing
// through the in-memory index (`@repo/contract/library/library-index`), built over the cell's rows for
// the one call, for a screen's pages, the rail's counts and the titles a note's links resolve
// against. An agent's lists and searches read the same index and the same search (`./cell-reads`).

import type { listedItemSchema, listingQuerySchema } from "@repo/contract/library/library-wire";
import {
  excerptAround,
  findTextOffsets,
  isPrintableAscii,
} from "@repo/editor/knowledge/text-matches";
import type { ItemCard } from "@repo/contract/library/derive-item";
import { LibraryIndex } from "@repo/contract/library/library-index";
import type { ListingRow } from "@repo/contract/library/library-index";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import {
  literalMatches,
  readBlocks,
  readItem,
  readLiveItems,
  searchLibrary,
} from "@repo/service/library/library-queries";
import type { LiteralMatch, SearchSide } from "@repo/service/library/library-queries";
import { runPlan } from "@repo/service/library/library-sql";
import type { SqlStatements } from "@repo/service/library/library-sql";
import { z } from "zod";

import { liveFolders } from "./cell-folders";
import { refuse } from "./cell-refusal";

type ListedItem = z.infer<typeof listedItemSchema>;

// a card as an answer carries it, its outline a list of its own
const answerCard = (card: ItemCard) => ({ ...card, outline: [...card.outline] });

// an item's row and every block it holds; one emptied from Deleted is no item
export const itemWhole = (sql: SqlStatements, id: string) => {
  const item = runPlan(sql, readItem(id));
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  return {
    blocks: runPlan(sql, readBlocks(id)),
    card: answerCard(item.card),
    fields: item.fields,
    id,
    kind: item.kind,
    seq: item.seq,
    updatedAt: item.updatedAt,
  };
};

export interface ItemListing extends ListingRow {
  readonly card: ItemCard;
  readonly fields: LibraryItemFields;
  readonly seq: number;
}

const tagRowSchema = z.object({ item_id: z.string(), tag: z.string() });

// every item the library holds (none purged), with the folders a listing files them under
export const listingOf = (sql: SqlStatements): LibraryIndex<ItemListing> => {
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
  for (const item of runPlan(sql, readLiveItems())) {
    const { fields } = item;
    index.upsert({
      card: item.card,
      deletedAt: fields.deletedAt,
      fields,
      folderId: fields.folderId,
      id: item.id,
      kind: fields.kind,
      pinnedAt: fields.pinnedAt,
      savedAt: fields.savedAt,
      seq: item.seq,
      tags: tags.get(item.id) ?? [],
      title: item.card.title,
      updatedAt: item.updatedAt,
      url: fields.url,
    });
  }
  index.setFolders(liveFolders(sql));
  return index;
};

// ---- search ----

// how many hits a search ranks before its filters, and how many items holding its exact text a
// read of the blocks names at once
const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

// the line of a block's text that holds the query, as an excerpt around its first match
const lineExcerpt = (text: string, query: string): string | null => {
  for (const line of text.split("\n")) {
    const [match] = findTextOffsets(line, query, { caseSensitive: false, wholeWord: false });
    if (match !== undefined) {
      const excerpt = excerptAround(line, match);
      return `${excerpt.before}${excerpt.text}${excerpt.after}`;
    }
  }
  return null;
};

// each hit's passage, best first: the ranked index, then the live items holding the query's exact
// text the index's words miss (a part of a word, punctuation, a person's typing its set has not
// sealed into the index yet), a page of them at a time until the candidates are full, so a common
// needle reads no more of the library's text than those pages' blocks; only an ascii query on one
// line has such a scan, since SQLite folds ascii case alone and a match lives in one line
export const searchHits = (
  sql: SqlStatements,
  query: string,
  side: SearchSide,
): Map<string, string> => {
  const hits = new Map<string, string>();
  for (const hit of runPlan(sql, searchLibrary(query, SEARCH_CANDIDATES, side))) {
    hits.set(hit.itemId, hit.snippet);
  }
  if (side === "deleted" || !isPrintableAscii(query)) {
    return hits;
  }
  let after: string | null = null;
  while (hits.size < SEARCH_CANDIDATES) {
    const page: LiteralMatch[] = runPlan(
      sql,
      literalMatches(query, { after, limit: LITERAL_PAGE }),
    );
    for (const match of page) {
      const excerpt = hits.has(match.itemId) ? null : lineExcerpt(match.text, query);
      if (excerpt !== null && hits.size < SEARCH_CANDIDATES) {
        hits.set(match.itemId, excerpt);
      }
    }
    const last: LiteralMatch | undefined = page.at(-1);
    if (last === undefined || page.length < LITERAL_PAGE) {
      break;
    }
    after = last.itemId;
  }
  return hits;
};

// ---- the apps' listing ----

export interface ListingPageInput {
  readonly query: z.infer<typeof listingQuerySchema>;
  readonly words?: string | undefined;
  readonly cursor?: number | undefined;
  readonly limit: number;
}

export const listingPage = (sql: SqlStatements, input: ListingPageInput) => {
  const offset = input.cursor ?? 0;
  const hits =
    input.words === undefined
      ? null
      : searchHits(sql, input.words, input.query.deleted ? "deleted" : "live");
  const page = listingOf(sql).items({
    ...input.query,
    limit: input.limit,
    offset,
    within: hits === null ? undefined : new Map([...hits.keys()].map((id, rank) => [id, rank])),
  });
  const end = offset + page.items.length;
  return {
    items: page.items.map((row): ListedItem => ({
      card: answerCard(row.card),
      fields: row.fields,
      id: row.id,
      seq: row.seq,
      snippet: hits?.get(row.id),
      tags: [...row.tags],
      updatedAt: row.updatedAt,
    })),
    kindCounts: page.kindCounts,
    nextCursor: end < page.total ? end : null,
    total: page.total,
  };
};

const EVERY_ROW = Number.MAX_SAFE_INTEGER;

// the rail's counts: every live folder named, and each tag under the spelling it met first
export const listingScopes = (sql: SqlStatements) => {
  const index = listingOf(sql);
  const scopes = index.scopes();
  const folders = new Map(liveFolders(sql).map((folder) => [folder.id, folder]));
  const tags = new Map<string, { tag: string; items: number }>();
  const live = index.items({ deleted: false, limit: EVERY_ROW, offset: 0, sort: "saved" });
  for (const row of live.items) {
    for (const tag of row.tags) {
      const key = tag.toLowerCase();
      const held = tags.get(key);
      tags.set(key, { items: (held?.items ?? 0) + 1, tag: held?.tag ?? tag });
    }
  }
  return {
    deleted: index.items({ deleted: true, limit: 0, offset: 0, sort: "saved" }).total,
    folders: scopes.folders.flatMap(({ id, items }) => {
      const folder = folders.get(id);
      return folder === undefined
        ? []
        : [{ id, items, name: folder.name, parentId: folder.parentId, sort: folder.sort }];
    }),
    tags: [...tags.values()].toSorted((a, b) => b.items - a.items || a.tag.localeCompare(b.tag)),
    total: scopes.total,
    unsorted: scopes.unsorted,
    untagged: scopes.untagged,
  };
};

export const listingTitles = (sql: SqlStatements) => ({
  targets: listingOf(sql)
    .items({ deleted: false, limit: EVERY_ROW, offset: 0, sort: "title" })
    .items.map((row) => ({ id: row.id, title: row.title })),
});
