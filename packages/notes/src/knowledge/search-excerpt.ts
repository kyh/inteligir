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

import { stemmer } from "stemmer";
import { clipSnippet } from "./projection";
import { tokenize, type SearchQueryTerm } from "./search-query";
import { splitLines } from "./source-lines";

/** Does this line hold something one of `terms` reached? Stems on both sides,
 * because that is how the term was matched in the first place; a term still
 * being typed also matches by prefix, exactly as the engines run it. */
function lineMatches(line: string, terms: readonly SearchQueryTerm[]): boolean {
  for (const token of tokenize(line)) {
    const stem = stemmer(token);
    for (const term of terms) {
      if (stem === term.stem) return true;
      if (term.prefix && token.startsWith(term.token)) return true;
    }
  }
  return false;
}

/** The line to show `text` by, clipped — empty when nothing in it matched, so
 * the caller can fall back to the title rather than print an arbitrary line. */
export function searchExcerpt(text: string, terms: readonly SearchQueryTerm[]): string {
  for (const raw of splitLines(text)) {
    const line = raw.trim();
    if (line === "") continue;
    if (lineMatches(line, terms)) return clipSnippet(line);
  }
  return "";
}
