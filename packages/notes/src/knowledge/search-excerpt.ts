// ---------------------------------------------------------------------------
// The one snippet policy both search engines execute: a result is shown by the
// first non-empty line holding a term the query actually MATCHED.
//
// It lives here for the reason search-query.ts does — two engines answering
// the same question two ways is a drift waiting to happen — and it exists at
// all because FTS5 cannot answer it once the index carries a stem shadow.
// `snippet()` cuts from ONE column using that column's own match offsets, and
// a stem-only hit lands in `body_stems`; FTS5 does not carry offsets across
// columns, so asking column 2 for a match it never saw hands back the note's
// opening words. A reader then gets filler under a hit they cannot see.
//
// So the cut is made here, over the LITERAL text, by the same terms the plan
// asked for — which also means a stemmed hit is excerpted at the word that
// actually matched (`exhausted` under a query of `exhausting`) rather than at
// the word the query happened to spell.
// ---------------------------------------------------------------------------

import { clipSnippet } from "./projection";
import { stemToken, tokenize, type SearchQueryTerm } from "./search-query";

/** Does this line hold something one of `terms` reached? Stems on both sides,
 * because that is how the term was matched in the first place; a term still
 * being typed also matches by prefix, exactly as the engines run it. */
function lineMatches(line: string, terms: readonly SearchQueryTerm[]): boolean {
  for (const token of tokenize(line)) {
    const stem = stemToken(token);
    for (const term of terms) {
      if (stem === term.stem) return true;
      if (term.prefix && token.startsWith(term.token)) return true;
    }
  }
  return false;
}

/** The line to show a doc by, clipped — empty when none of its lines matched,
 * so the caller can fall back to the title rather than print an arbitrary one.
 *
 * It takes LINES rather than text because what a line is belongs to
 * ./source-lines and to nowhere else: the SQL store splits the body it just
 * read, and the pure index already holds the split it made at index time. */
export function searchExcerpt(lines: readonly string[], terms: readonly SearchQueryTerm[]): string {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (lineMatches(line, terms)) return clipSnippet(line);
  }
  return "";
}
