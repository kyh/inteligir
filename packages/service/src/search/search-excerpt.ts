// A hit's passage: the first line of its text holding a match, clipped around the match. Not
// FTS5's snippet(): it cuts one column by that column's own match offsets, and a stem-only hit
// lands in `body_stems`, so asking the literal column hands back the note's opening words. So the
// cut is here, over the text the cell keeps.

import type { TextOffset } from "@repo/editor/headless/knowledge/text-matches";

import { stemToken, tokenize } from "./search-query";
import type { SearchQueryTerm } from "./search-query";

const EXCERPT_BEFORE = 40;
const EXCERPT_AFTER = 80;

// a match's line clipped around it, as a listing row shows it
export const excerptAround = (line: string, match: TextOffset): string => {
  const from = Math.max(0, match.offset - EXCERPT_BEFORE);
  const to = Math.min(line.length, match.offset + match.length + EXCERPT_AFTER);
  return `${from > 0 ? "…" : ""}${line.slice(from, to)}${to < line.length ? "…" : ""}`;
};

// where a line's first match sits, when it holds one
export type FindMatch = (line: string) => TextOffset | undefined;

const LINE_END = /\r\n|\r|\n/u;

export const passageIn = (text: string, find: FindMatch): string | null => {
  for (const raw of text.split(LINE_END)) {
    const line = raw.trim();
    const match = find(line);
    if (match !== undefined) {
      return excerptAround(line, match);
    }
  }
  return null;
};

// what the index reads as one token, in the text as written: a mark folds into its letter
const WORD = /[\p{L}\p{N}\p{Mn}_]+/gu;

// stems on both sides and honours prefix, matching how the index matched the term; the literal
// token answers first because it is the common hit and costs no stemming
const tokenMatches = (token: string, terms: readonly SearchQueryTerm[]): boolean => {
  if (terms.some((term) => token === term.token || (term.prefix && token.startsWith(term.token)))) {
    return true;
  }
  const stem = stemToken(token);
  return terms.some((term) => stem === term.stem);
};

// the first word of a line the index matched a term by
export const termMatch =
  (terms: readonly SearchQueryTerm[]): FindMatch =>
  (line) => {
    for (const word of line.matchAll(WORD)) {
      if (tokenize(word[0]).some((token) => tokenMatches(token, terms))) {
        return { length: word[0].length, offset: word.index };
      }
    }
  };
