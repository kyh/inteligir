// Not FTS5's snippet(): it cuts one column by that column's own match offsets,
// and a stem-only hit lands in `body_stems`, so asking the literal column hands
// back the note's opening words. Both engines cut here, over the literal text.

import { clipSnippet } from "./projection";
import { stemToken, tokenize, type SearchQueryTerm } from "./search-query";

// stems on both sides and honours prefix, matching how the engines matched the term
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

export function searchExcerpt(lines: readonly string[], terms: readonly SearchQueryTerm[]): string {
  for (const raw of lines) {
    const line = raw.trim();
    if (line === "") continue;
    if (lineMatches(line, terms)) return clipSnippet(line);
  }
  return "";
}
