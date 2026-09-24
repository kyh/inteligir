// Not FTS5's snippet(): it cuts one column by that column's own match offsets,
// and a stem-only hit lands in `body_stems`, so asking the literal column hands
// back the note's opening words. Both engines cut here, over the literal text.

import { clipSnippet } from "./projection";
import { stemToken, tokenize } from "./search-query";
import type { SearchQueryTerm } from "./search-query";

// a title-only hit on a long note would otherwise tokenize and stem the whole body to find
// nothing; past this many characters the caller shows the title instead
export const SEARCH_EXCERPT_SCAN_CHARS = 64 * 1024;

// source-lines' terminators, found one at a time so a scan that stops early splits nothing more
const LINE_TERMINATOR = /\r\n|\r|\n/gu;

// stems on both sides and honours prefix, matching how the engines matched the term; the literal
// token answers first because it is the common hit and costs no stemming
const lineMatches = (line: string, terms: readonly SearchQueryTerm[]): boolean => {
  for (const token of tokenize(line)) {
    if (
      terms.some((term) => token === term.token || (term.prefix && token.startsWith(term.token)))
    ) {
      return true;
    }
    const stem = stemToken(token);
    if (terms.some((term) => stem === term.stem)) {
      return true;
    }
  }
  return false;
};

export const searchExcerpt = (body: string, terms: readonly SearchQueryTerm[]): string => {
  let start = 0;
  while (start < Math.min(body.length, SEARCH_EXCERPT_SCAN_CHARS)) {
    LINE_TERMINATOR.lastIndex = start;
    const terminator = LINE_TERMINATOR.exec(body);
    const end = terminator === null ? body.length : terminator.index;
    const line = body.slice(start, Math.min(end, SEARCH_EXCERPT_SCAN_CHARS)).trim();
    if (line !== "" && lineMatches(line, terms)) {
      return clipSnippet(line);
    }
    if (terminator === null) {
      return "";
    }
    start = end + terminator[0].length;
  }
  return "";
};
