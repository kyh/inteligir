// ---------------------------------------------------------------------------
// The one query policy both search engines execute.
//
// Tokenization, the stopword drop and the all/any decision live HERE rather
// than in either engine, because the pure SearchIndex and the SQL store's FTS5
// must answer the same question the same way — and a policy spelled twice is a
// policy that drifts. Each engine keeps only its own EXECUTION: a postings walk
// on one side, a MATCH expression on the other.
//
// The policy, and why each half of it:
//
//   - Stopwords are DROPPED. Requiring them is what made a sentence-shaped
//     query return nothing at all: "how do I stop feeling burnt out at work"
//     asked for a note carrying `how`, `do` AND `at`. OR-ing them back in is
//     worse than dropping them — a note then matches on `i` alone.
//   - A query with nothing left keeps its tokens and stays a conjunction. An
//     empty match expression is not "no filter", it is every note in the
//     vault; and "how do I" read literally is a phrase lookup, which the
//     conjunction answers precisely. So the floor costs no behaviour change at
//     all for those queries.
//   - Two terms or fewer stay a CONJUNCTION; three or more become a
//     disjunction the engine ranks. A short query is a lookup where both words
//     ARE the query ("deploy runbook"), and relaxing it only hangs a tail of
//     half-matches under the same top hit. A sentence is the opposite: no note
//     holds every word, so requiring them all is the bug. The same split ships
//     as Elasticsearch's `minimum_should_match` default idiom.
//   - A lookup that finds NOTHING is relaxed and asked again. It was a
//     question in disguise ("what is the book about concentration" reduces to
//     two content words, and the note says `concentration` but never `book`),
//     or one of its words is a morphological variant the tokenizer does not
//     stem (`ranking` against a note reading `ranked`). It can cost a
//     successful lookup nothing: the second query runs only where the first
//     returned no rows at all.
//
// Which constant here is right is a MEASUREMENT rather than a taste. The
// evaluation harness beside the node host's knowledge tests
// (apps/app/src/node/knowledge/__tests__/search-eval.test.ts) scores this whole
// policy over a labelled vault; a change here that does not move those numbers
// is not an improvement.
//   - The token still being TYPED prefix-matches, so the box answers before
//     the word is finished. It is the last token of the RAW query rather than
//     the last surviving term: a term with a stopword after it is a word the
//     user already finished typing.
// ---------------------------------------------------------------------------

/** Unicode-aware tokens: letter/number/underscore runs, lowercased. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

/** One token to look up, and whether it matches by prefix. */
export type SearchQueryTerm = { token: string; prefix: boolean };

/** What an engine has to run. `match` is "all" (every term must hit) or "any"
 * (one is enough, and hitting more is what the ranking rewards). */
export type SearchQueryPlan = {
  terms: readonly SearchQueryTerm[];
  match: "all" | "any";
};

/** At or below this many content terms the query is a lookup and every term is
 * required; above it, it is a sentence and the ranking decides. */
const CONJUNCTION_MAX_TERMS = 2;

/** Below this, a conjunction and a disjunction ask the same question, so the
 * relaxed plan would only re-run the one that just failed. */
const RELAXABLE_MIN_TERMS = 2;

/** English function words: they carry no topic, they are in almost every note,
 * and they are most of what a question asked as a sentence is made of. Kept
 * deliberately short of the fuller published lists — words with any topical
 * reading of their own ("other", "more", "same", "few") stay searchable. */
const STOPWORDS = new Set(
  `a about above after again against all am an and any are as at
   be because been before being below between both but by
   can could did do does doing done down during
   each for from further
   had has have having he her here hers herself him himself his how
   i if in into is it its itself
   just me my myself
   nor not now of off on once only or our ours ourselves out over
   s should so some such
   t than that the their theirs them themselves then there these they this those through to too
   under until up us
   very was we were what when where whether which while who whom why will with would
   you your yours yourself`
    .split(/\s+/)
    .filter((word) => word !== ""),
);

/** The plans to run for `query`, in order — the FIRST that matches anything is
 * the answer. Empty when the query holds no tokens at all (a search for
 * nothing is not a search for everything). */
export function planSearchQuery(query: string): readonly SearchQueryPlan[] {
  const raw = tokenize(query);
  const typing = raw[raw.length - 1];
  if (typing === undefined) return [];

  const unique = [...new Set(raw)];
  const content = unique.filter((token) => !STOPWORDS.has(token));
  const terms = (content.length > 0 ? content : unique).map((token) => ({
    token,
    prefix: token === typing,
  }));

  if (content.length > CONJUNCTION_MAX_TERMS) return [{ terms, match: "any" }];
  if (content.length < RELAXABLE_MIN_TERMS) return [{ terms, match: "all" }];
  return [
    { terms, match: "all" },
    { terms, match: "any" },
  ];
}
