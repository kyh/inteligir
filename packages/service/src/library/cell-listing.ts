// What the apps read of the library, inside one read transaction: an item whole, and the listing
// through the in-memory index (`@repo/contract/library/library-index`), which the cell holds between
// calls (`holdListing`), for a screen's pages, the rail's counts and the titles a note's links
// resolve against, each answer assembled there, a page's rows read whole from their own. An agent's
// lists and searches read the same index and the same search (`./cell-reads`).

import {
  answerCard,
  itemListing,
  LibraryIndex,
  listingPageOf,
} from "@repo/contract/library/library-index";
import type { ListingRow } from "@repo/contract/library/library-index";
import type { listingPageInputSchema } from "@repo/contract/library/library-wire";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { searchHits } from "../search/search-hits";
import { readItem, readListingRows, readListingSince } from "./library-queries";
import type { StoredItem } from "./library-queries";
import { LibraryRowError } from "./library-sql";
import { asc, gt, inArray } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import type { z } from "zod";

import { items, itemTags } from "@repo/db/cell/schema";
import type { CellDb } from "./cell-db";
import { liveFolders } from "./cell-folders";
import { refuse } from "./cell-refusal";

// an item's row as the apps read it; one emptied from Deleted is no item
export const itemRow = (db: CellDb, id: string) => {
  const item = readItem(db, id);
  if (item === null) {
    return refuse({ kind: "not-found" });
  }
  return {
    card: answerCard(item.card),
    fields: item.fields,
    id,
    seq: item.seq,
    updatedAt: item.updatedAt,
  };
};

// an item's row and its body's blocks, read from where the body lives
export const itemWhole = (db: CellDb, id: string, blocks: readonly BodyBlock[]) => ({
  ...itemRow(db, id),
  blocks: [...blocks],
});

// each tag the items `where` names carry, their field's and their body's, each spelling once
export const tagsOf = (db: CellDb, where?: SQL): Map<string, string[]> => {
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

// every item the library holds, with the folders a listing files them under
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
  const moved = readListingSince(db, since);
  for (const facts of moved.items) {
    index.upsert({ ...facts, tags: tags.get(facts.id) ?? [] });
  }
  for (const id of moved.purged) {
    index.remove(id);
  }
  index.setFolders(liveFolders(db));
};

// The listing at the library's head, kept between calls: building it reads every live row, which
// a read on every call could not afford past a few thousand items. Every write stamps each item and
// folder row it touches with the sequence its transaction takes, so the rows past the held head are
// what moved since; a head behind it is a library wiped under it, read again whole. The cell keeps
// one in its memory, so it goes when the object sleeps and the first read after the wake builds it.
type ListingHold = (db: CellDb, head: number) => LibraryIndex<ListingRow>;

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
export const listedWhole = (db: CellDb, id: string): StoredItem => {
  const item = readItem(db, id);
  if (item === null) {
    throw new LibraryRowError(`the listing names the item ${id}, which the library does not hold`);
  }
  return item;
};

// ---- the apps' listing ----

export const listingPage = (
  db: CellDb,
  listing: LibraryIndex<ListingRow>,
  input: z.output<typeof listingPageInputSchema>,
) =>
  listingPageOf(
    listing,
    input,
    (words, deleted) => searchHits(db, words, deleted ? "deleted" : "live"),
    (row) => itemListing(listedWhole(db, row.id), row.tags),
  );
