// A search's hits, best first, in two tiers: the ranked index (`./search-index`), then the live
// items whose body holds the query's exact text, which the index's words miss (a part of a word,
// punctuation). The exact text is matched with instr(), since a Durable Object refuses a
// pattern-match operand past 50 bytes. A hit is an id until a page shows it, and its passage is
// cut then (`./search-excerpt`), so a search reads the text of a page's rows and no other.

import { and, asc, eq, gt, isNull, sql } from "drizzle-orm";

import { bodyTexts, items } from "@repo/db/cell/schema";
import { deriveItem } from "@repo/contract/library/derive-item";
import type { SearchHits } from "@repo/contract/library/library-index";
import { findTextOffsets } from "@repo/editor/knowledge/text-matches";

import { readBodyOpening } from "../library/cell-body";
import type { CellDb } from "../library/cell-db";
import { readLiveItem } from "../library/library-queries";
import { passageIn, termMatch } from "./search-excerpt";
import { searchLibrary } from "./search-index";
import type { SearchSide } from "./search-index";

// a body part holds `folded`, matched case-folded, since SQLite's lower() folds ascii alone
const holds = (folded: string) => sql`instr(lower(${bodyTexts.text}), ${folded}) > 0`;

// the live items whose body holds `needle` (printable ascii), in id order after `after` and at most
// `limit` of them
export const literalMatches = (
  db: CellDb,
  needle: string,
  page: { readonly after: string | null; readonly limit: number },
): string[] =>
  db
    .selectDistinct({ itemId: bodyTexts.itemId })
    .from(bodyTexts)
    .innerJoin(items, eq(items.id, bodyTexts.itemId))
    .where(
      and(
        gt(bodyTexts.itemId, page.after ?? ""),
        isNull(items.deletedAt),
        eq(items.purged, 0),
        holds(needle.toLowerCase()),
      ),
    )
    .orderBy(asc(bodyTexts.itemId))
    .limit(page.limit)
    .all()
    .map((row) => row.itemId);

// the first line of an item's body holding `needle`: a body's text is cut into parts at line ends,
// so a line lives in one part, and only the first part that holds the needle is read
const literalPassage = (db: CellDb, itemId: string, needle: string): string | null => {
  const folded = needle.toLowerCase();
  const part = db
    .select({ text: bodyTexts.text })
    .from(bodyTexts)
    .where(and(eq(bodyTexts.itemId, itemId), holds(folded)))
    .orderBy(asc(bodyTexts.part))
    .limit(1)
    .get();
  return part === undefined
    ? null
    : passageIn(part.text, (line) =>
        line.toLowerCase().includes(folded)
          ? findTextOffsets(line, needle, { caseSensitive: false, wholeWord: false })[0]
          : undefined,
      );
};

const PRINTABLE_ASCII = /^[ -~]+$/u;

// the needles SQLite's case fold reads as the editor's matcher does, each on one line
export const isPrintableAscii = (needle: string): boolean => PRINTABLE_ASCII.test(needle);

// how many hits a search ranks before its filters, and how many items holding its exact text a
// read of the bodies' text names at once
const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

// how far into a body a ranked hit's passage is looked for; a hit past it shows its title
const PASSAGE_SCAN_CHARS = 64 * 1024;

// what the index reads of an item beside its title, headings and body: its address, site, author,
// description and tags, from the item's own row
const metaOf = (db: CellDb, itemId: string): string => {
  const item = readLiveItem(db, itemId);
  return item === null ? "" : deriveItem(item.fields, item.body.digest).search.meta;
};

// the ranked index, then the live items holding the query's exact text, a page of them at a time
// until the candidates are full, so a common needle names no more of the library than those pages;
// only an ascii query on one line has such a scan, since SQLite folds ascii case alone and a match
// lives in one line. A ranked hit's passage is a line of its body, else of what its row says of it
export const searchHits = (db: CellDb, query: string, side: SearchSide): SearchHits => {
  const ranked = searchLibrary(db, query, SEARCH_CANDIDATES, side);
  const rank = new Map(ranked.ids.map((id, place) => [id, place]));
  const literal = new Set<string>();
  if (side === "live" && isPrintableAscii(query)) {
    let after: string | null = null;
    while (rank.size < SEARCH_CANDIDATES) {
      const page: string[] = literalMatches(db, query, { after, limit: LITERAL_PAGE });
      for (const id of page) {
        if (!rank.has(id) && rank.size < SEARCH_CANDIDATES) {
          rank.set(id, rank.size);
          literal.add(id);
        }
      }
      const last: string | undefined = page.at(-1);
      if (last === undefined || page.length < LITERAL_PAGE) {
        break;
      }
      after = last;
    }
  }
  const find = termMatch(ranked.terms);
  return {
    passage: (id) =>
      literal.has(id)
        ? literalPassage(db, id, query)
        : (passageIn(readBodyOpening(db, id, PASSAGE_SCAN_CHARS), find) ??
          passageIn(metaOf(db, id), find)),
    rank,
  };
};
