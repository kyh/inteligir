// A search's hits, best first, in two tiers: the ranked index (`./search-index`), then the live
// items whose body holds the query's exact text, which the index's words miss (a part of a word,
// punctuation). The exact text is matched with instr(), since a Durable Object refuses a
// pattern-match operand past 50 bytes.

import { z } from "zod";

import { findTextOffsets } from "@repo/editor/knowledge/text-matches";
import type { TextOffset } from "@repo/editor/knowledge/text-matches";

import type { CellStorage } from "../library/cell-storage";
import { parseRow } from "../library/library-sql";
import { searchLibrary } from "./search-index";
import type { SearchSide } from "./search-index";

interface LiteralMatch {
  readonly itemId: string;
  // the first line of the item's body that holds the needle
  readonly text: string;
}

const matchedRowSchema = z.object({ item_id: z.string() });
const partTextSchema = z.object({ text: z.string() });

// the live items whose body holds `needle` (printable ascii, matched case-folded, since SQLite's
// lower() folds ascii alone), in id order after `after` and at most `limit` of them, each with its
// first such line: a body's text is cut into parts at line ends, so a line lives in one part, and
// only the first part that holds the needle is read, whatever the library holds
export const literalMatches = (
  storage: CellStorage,
  needle: string,
  page: { readonly after: string | null; readonly limit: number },
): LiteralMatch[] => {
  const folded = needle.toLowerCase();
  const ids: string[] = [];
  for (const raw of storage.all(
    `SELECT DISTINCT t.item_id FROM body_texts t JOIN items i ON i.id = t.item_id
     WHERE t.item_id > ? AND i.deleted_at IS NULL AND i.purged = 0 AND instr(lower(t.text), ?) > 0
     ORDER BY t.item_id LIMIT ?`,
    [page.after ?? "", folded, page.limit],
  )) {
    ids.push(parseRow(raw, matchedRowSchema, "a matched item").item_id);
  }
  const matches: LiteralMatch[] = [];
  for (const itemId of ids) {
    const [raw] = storage.all(
      `SELECT text FROM body_texts WHERE item_id = ? AND instr(lower(text), ?) > 0
       ORDER BY part LIMIT 1`,
      [itemId, folded],
    );
    const line =
      raw === undefined
        ? undefined
        : parseRow(raw, partTextSchema, "a body's text")
            .text.split("\n")
            .find((one) => one.toLowerCase().includes(folded));
    if (line !== undefined) {
      matches.push({ itemId, text: line });
    }
  }
  return matches;
};

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

// a match's line clipped around it, as a listing row shows it
export const excerptAround = (line: string, match: TextOffset): string => {
  const from = Math.max(0, match.offset - EXCERPT_BEFORE);
  const to = Math.min(line.length, match.offset + match.length + EXCERPT_AFTER);
  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
};

const PRINTABLE_ASCII = /^[\u0020-\u007E]+$/u;

// the needles SQLite's case fold reads as the editor's matcher does, each on one line
export const isPrintableAscii = (needle: string): boolean => PRINTABLE_ASCII.test(needle);

// how many hits a search ranks before its filters, and how many items holding its exact text a
// read of the bodies' text names at once
const SEARCH_CANDIDATES = 200;
const LITERAL_PAGE = 50;

// the line of a body's text that holds the query, as an excerpt around its first match
const lineExcerpt = (text: string, query: string): string | null => {
  for (const line of text.split("\n")) {
    const [match] = findTextOffsets(line, query, { caseSensitive: false, wholeWord: false });
    if (match !== undefined) {
      return excerptAround(line, match);
    }
  }
  return null;
};

// each hit's passage, best first: the ranked index, then the live items holding the query's exact
// text, a page of them at a time until the candidates are full, so a common needle reads no more
// of the library's text than those pages' lines; only an ascii query on one line has such a scan,
// since SQLite folds ascii case alone and a match lives in one line
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
