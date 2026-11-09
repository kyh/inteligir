// What the apps read of the library, inside one read transaction: an item whole, and the listing
// through the in-memory index (`@repo/contract/library/library-index`), built over the cell's rows for
// the one call, for a screen's pages, the rail's counts and the titles a note's links resolve
// against, each answer assembled there. An agent's lists and searches read the same index and the
// same search (`./cell-reads`).

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
import type { ItemListing, ListingPageInput } from "@repo/contract/library/library-index";
import {
  literalMatches,
  readBlocks,
  readItem,
  readLiveItems,
  searchLibrary,
} from "./library-queries";
import type { LiteralMatch, SearchSide } from "./library-queries";
import { runPlan } from "./library-sql";
import { asc } from "drizzle-orm";

import { itemTags } from "@repo/db/cell/schema";
import type { CellDb } from "./cell-db";
import { liveFolders } from "./cell-folders";
import type { CellStorage } from "./cell-storage";
import { refuse } from "./cell-refusal";

// an item's row and every block it holds; one emptied from Deleted is no item
export const itemWhole = (storage: CellStorage, id: string) => {
  const item = readItem(storage.db, id);
  if (item?.kind !== "live") {
    return refuse({ kind: "not-found" });
  }
  return {
    blocks: runPlan(storage, readBlocks(id)),
    card: answerCard(item.card),
    fields: item.fields,
    id,
    kind: item.kind,
    seq: item.seq,
    updatedAt: item.updatedAt,
  };
};

// every item the library holds (none purged), with the folders a listing files them under
export const listingOf = (db: CellDb): LibraryIndex<ItemListing> => {
  const tags = new Map<string, string[]>();
  for (const row of db
    .select({ itemId: itemTags.itemId, tag: itemTags.tag })
    .from(itemTags)
    .orderBy(asc(itemTags.itemId), asc(itemTags.tag))
    .all()) {
    const held = tags.get(row.itemId) ?? [];
    if (!held.includes(row.tag)) {
      held.push(row.tag);
    }
    tags.set(row.itemId, held);
  }
  const index = new LibraryIndex<ItemListing>();
  for (const item of readLiveItems(db)) {
    index.upsert(itemListing(item, tags.get(item.id) ?? []));
  }
  index.setFolders(liveFolders(db));
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
  storage: CellStorage,
  query: string,
  side: SearchSide,
): Map<string, string> => {
  const hits = new Map<string, string>();
  for (const hit of runPlan(storage, searchLibrary(query, SEARCH_CANDIDATES, side))) {
    hits.set(hit.itemId, hit.snippet);
  }
  if (side === "deleted" || !isPrintableAscii(query)) {
    return hits;
  }
  let after: string | null = null;
  while (hits.size < SEARCH_CANDIDATES) {
    const page: LiteralMatch[] = runPlan(
      storage,
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

export const listingPage = (
  storage: CellStorage,
  input: ListingPageInput & { readonly words?: string | undefined },
) =>
  listingPageOf(
    listingOf(storage.db),
    input,
    input.words === undefined
      ? null
      : searchHits(storage, input.words, input.query.deleted ? "deleted" : "live"),
  );
