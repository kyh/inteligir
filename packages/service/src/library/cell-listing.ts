// What the apps read of the library, inside one read transaction: an item whole, and the listing
// through the in-memory index (`@repo/contract/library/library-index`), which the cell holds between
// calls (`holdListing`), for a screen's pages, the rail's counts and the titles a note's links
// resolve against, each answer assembled there, a page's rows read whole from their own. An agent's
// lists and searches read the same index and the same search (`./cell-reads`).

import {
  excerptAround,
  findTextOffsets,
  isPrintableAscii,
} from "@repo/editor/knowledge/text-matches";
import {
  answerCard,
  itemListing,
  LibraryIndex,
  listingPageOf,
} from "@repo/contract/library/library-index";
import type { ListingPageInput, ListingRow } from "@repo/contract/library/library-index";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import {
  literalMatches,
  readItem,
  readListingRows,
  readListingSince,
  readLiveItem,
  searchLibrary,
} from "./library-queries";
import type { LiteralMatch, LiveStoredItem, SearchSide } from "./library-queries";
import { LibraryRowError } from "./library-sql";
import { asc, gt, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";

import { items, itemTags } from "@repo/db/cell/schema";
import type { CellDb } from "./cell-db";
import { liveFolders } from "./cell-folders";
import type { CellStorage } from "./cell-storage";
import { refuse } from "./cell-refusal";

// an item's row as the apps read it; one emptied from Deleted is no item
export const itemRow = (storage: CellStorage, id: string) => {
  const item = readItem(storage.db, id);
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  return {
    card: answerCard(item.card),
    fields: item.fields,
    id,
    kind: item.kind,
    seq: item.seq,
    updatedAt: item.updatedAt,
  };
};

// an item's row and its body's blocks, read from where the body lives
export const itemWhole = (storage: CellStorage, id: string, blocks: readonly BodyBlock[]) => ({
  ...itemRow(storage, id),
  blocks: [...blocks],
});

// each tag the items `where` names carry, their field's and their body's, each spelling once
const tagsOf = (db: CellDb, where?: SQL): Map<string, string[]> => {
  const tags = new Map<string, string[]>();
  for (const row of db
    .select({ itemId: itemTags.itemId, tag: itemTags.tag })
    .from(itemTags)
    .where(where)
    .orderBy(asc(itemTags.itemId), asc(itemTags.tag))
    .all()) {
    const held = tags.get(row.itemId) ?? [];
    if (!held.includes(row.tag)) {
      held.push(row.tag);
    }
    tags.set(row.itemId, held);
  }
  return tags;
};

// every item the library holds (none purged), with the folders a listing files them under
const listingOf = (db: CellDb): LibraryIndex<ListingRow> => {
  const tags = tagsOf(db);
  const index = new LibraryIndex<ListingRow>();
  for (const facts of readListingRows(db)) {
    index.upsert({ ...facts, tags: tags.get(facts.id) ?? [] });
  }
  index.setFolders(liveFolders(db));
  return index;
};

// the items stamped past `since` taken in again, a purged one let go, and the folders read again
const catchUp = (db: CellDb, index: LibraryIndex<ListingRow>, since: number): void => {
  const stamped = db.select({ id: items.id }).from(items).where(gt(items.seq, since));
  const tags = tagsOf(db, inArray(itemTags.itemId, stamped));
  for (const change of readListingSince(db, since)) {
    if (change.kind === "purged") {
      index.remove(change.id);
    } else {
      index.upsert({ ...change.facts, tags: tags.get(change.facts.id) ?? [] });
    }
  }
  index.setFolders(liveFolders(db));
};

// The listing at the library's head, kept between calls: building it reads every live row, which
// a read on every call could not afford past a few thousand items. Every write stamps each item and
// folder row it touches with the sequence its transaction takes, so the rows past the held head are
// what moved since; a head behind it is a library wiped under it, read again whole. The cell keeps
// one in its memory, so it goes when the object sleeps and the first read after the wake builds it.
export type ListingHold = (db: CellDb, head: number) => LibraryIndex<ListingRow>;

export const holdListing = (): ListingHold => {
  let held: { readonly head: number; readonly index: LibraryIndex<ListingRow> } | null = null;
  return (db, head) => {
    if (held === null || head < held.head) {
      held = { head, index: listingOf(db) };
    } else if (head > held.head) {
      catchUp(db, held.index, held.head);
      held = { head, index: held.index };
    }
    return held.index;
  };
};

// an item the listing names, read whole from its row in the same read
export const listedWhole = (db: CellDb, id: string): LiveStoredItem => {
  const item = readLiveItem(db, id);
  if (item === null) {
    throw new LibraryRowError(`the listing names the item ${id}, which the library does not hold`);
  }
  return item;
};

// ---- search ----

// how many hits a search ranks before its filters, and how many items holding its exact text a
// read of the bodies' text names at once
const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

// the line of a body's text that holds the query, as an excerpt around its first match
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
// text the index's words miss (a part of a word, punctuation), a page of them at a time until the
// candidates are full, so a common needle reads no more of the library's text than those pages'
// lines; only an ascii query on one
// line has such a scan, since SQLite folds ascii case alone and a match lives in one line
export const searchHits = (
  storage: CellStorage,
  query: string,
  side: SearchSide,
): Map<string, string> => {
  const hits = new Map<string, string>();
  for (const hit of searchLibrary(storage, query, SEARCH_CANDIDATES, side)) {
    hits.set(hit.itemId, hit.snippet);
  }
  if (side === "deleted" || !isPrintableAscii(query)) {
    return hits;
  }
  let after: string | null = null;
  while (hits.size < SEARCH_CANDIDATES) {
    const page: LiteralMatch[] = literalMatches(storage, query, { after, limit: LITERAL_PAGE });
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

export const listingPage = (
  storage: CellStorage,
  listing: LibraryIndex<ListingRow>,
  input: ListingPageInput & { readonly words?: string | undefined },
) =>
  listingPageOf(
    listing,
    input,
    input.words === undefined
      ? null
      : searchHits(storage, input.words, input.query.deleted ? "deleted" : "live"),
    (row) => itemListing(listedWhole(storage.db, row.id), row.tags),
  );
