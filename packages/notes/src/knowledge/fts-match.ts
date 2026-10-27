// A search plan as an FTS5 MATCH expression over the four literal columns and their stem shadows,
// which every SQLite index of the library spells alike.

import type { SearchQueryPlan } from "./search-query";

const LITERAL_COLUMNS = "{title headings meta body}";
const STEM_COLUMNS = "{title_stems heading_stems meta_stems body_stems}";

// every term is quoted because fts5 reads AND/OR/NOT/NEAR, `*`, `^`, `:`, `-` and parens as
// syntax, and the tokenizer cannot emit a `"`, so nothing can close the quote. literal arm OR
// stem arm is the exact tier (search-index.ts has the porter example), and each term is
// parenthesized so its inner OR cannot bind against the joining AND
export const renderFtsMatch = (plan: SearchQueryPlan): string =>
  plan.terms
    .map(
      (term) =>
        `(${LITERAL_COLUMNS}: "${term.token}"${term.prefix ? " *" : ""}` +
        ` OR ${STEM_COLUMNS}: "${term.stem}")`,
    )
    .join(plan.match === "all" ? " AND " : " OR ");
