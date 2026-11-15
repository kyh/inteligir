// A search's hits, best first, in two tiers: the ranked index (`./search-index`), then the live
// items whose body holds the query's exact text, which the index's words miss (a part of a word,
// punctuation). The exact text is matched with instr(), since a Durable Object refuses a
// pattern-match operand past 50 bytes. A hit is an id until a page shows it, and its passage is
// cut then (`./search-excerpt`), so a search reads the text of a page's rows and no other.

import { z } from "zod";

import { deriveItem } from "@repo/contract/library/derive-item";
import type { SearchHits } from "@repo/contract/library/library-index";
import { findTextOffsets } from "@repo/editor/knowledge/text-matches";

import { readBodyOpening } from "../library/cell-body";
import type { CellStorage } from "../library/cell-storage";
import { readLiveItem } from "../library/library-queries";
import { parseRow } from "../library/library-sql";
import { passageIn, termMatch } from "./search-excerpt";
import { searchLibrary } from "./search-index";
import type { SearchSide } from "./search-index";

const matchedRowSchema = z.object({ item_id: z.string() });
const partTextSchema = z.object({ text: z.string() });

// the live items whose body holds `needle` (printable ascii, matched case-folded, since SQLite's
// lower() folds ascii alone), in id order after `after` and at most `limit` of them
export const literalMatches = (
  storage: CellStorage,
  needle: string,
  page: { readonly after: string | null; readonly limit: number },
): string[] =>
  storage
    .all(
      `SELECT DISTINCT t.item_id FROM body_texts t JOIN items i ON i.id = t.item_id
     WHERE t.item_id > ? AND i.deleted_at IS NULL AND i.purged = 0 AND instr(lower(t.text), ?) > 0
     ORDER BY t.item_id LIMIT ?`,
      [page.after ?? "", needle.toLowerCase(), page.limit],
    )
    .map((raw) => parseRow(raw, matchedRowSchema, "a matched item").item_id);

// the first line of an item's body holding `needle`: a body's text is cut into parts at line ends,
// so a line lives in one part, and only the first part that holds the needle is read
const literalPassage = (storage: CellStorage, itemId: string, needle: string): string | null => {
  const folded = needle.toLowerCase();
  const [raw] = storage.all(
    `SELECT text FROM body_texts WHERE item_id = ? AND instr(lower(text), ?) > 0
     ORDER BY part LIMIT 1`,
    [itemId, folded],
  );
  return raw === undefined
    ? null
    : passageIn(parseRow(raw, partTextSchema, "a body's text").text, (line) =>
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
const metaOf = (storage: CellStorage, itemId: string): string => {
  const item = readLiveItem(storage.db, itemId);
  return item === null ? "" : deriveItem(item.fields, item.body.digest).search.meta;
};

// the ranked index, then the live items holding the query's exact text, a page of them at a time
// until the candidates are full, so a common needle names no more of the library than those pages;
// only an ascii query on one line has such a scan, since SQLite folds ascii case alone and a match
// lives in one line. A ranked hit's passage is a line of its body, else of what its row says of it
export const searchHits = (storage: CellStorage, query: string, side: SearchSide): SearchHits => {
  const ranked = searchLibrary(storage, query, SEARCH_CANDIDATES, side);
  const rank = new Map(ranked.ids.map((id, place) => [id, place]));
  const literal = new Set<string>();
  if (side === "live" && isPrintableAscii(query)) {
    let after: string | null = null;
    while (rank.size < SEARCH_CANDIDATES) {
      const page: string[] = literalMatches(storage, query, { after, limit: LITERAL_PAGE });
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
        ? literalPassage(storage, id, query)
        : (passageIn(readBodyOpening(storage.db, id, PASSAGE_SCAN_CHARS), find) ??
          passageIn(metaOf(storage, id), find)),
    rank,
  };
};
