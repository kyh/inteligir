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
//     two content words, and the note says `concentration` but never `book`).
//     It can cost a successful lookup nothing: the second query runs only
//     where the first returned no rows at all.
//   - Every term is matched by its STEM, so `interviewing` reaches a note that
//     says `interviewers`. The term still being TYPED is matched by its stem
//     AND by prefix against the literal text, because it is a fragment right
//     up until it is a word — see stemText below for why those two cannot be
//     served by one index.
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

import { stemmer } from "stemmer";

/** Unicode-aware tokens: letter/number/underscore runs, lowercased and folded.
 *
 * The FOLD is not a nicety — it is what keeps the two engines answering the
 * same question. FTS5's `unicode61` strips diacritics itself, so an unfolded
 * tokenizer here indexes `acción` where the SQL store indexes `accion`, and a
 * query for `acciones` then reaches one engine and not the other. The literal
 * path hid that (both sides folded the query the same way they folded their
 * own index); the stem shadow does not, because the stem is computed HERE and
 * folded THERE. So the fold moves to the one tokenizer both engines share, and
 * the store pins `remove_diacritics 2` against it.
 *
 * NFD + dropping nonspacing marks is exactly what unicode61 does over the
 * cases this vault can hold — checked, rather than assumed, in the store's own
 * suite: `Łódź`, `İstanbul`, `ñandú` fold identically, and `Straße`, `søster`,
 * Cyrillic and CJK are left alone by both. */
export function tokenize(text: string): string[] {
  return foldDiacritics(text.toLowerCase()).match(/[\p{L}\p{N}_]+/gu) ?? [];
}

function foldDiacritics(text: string): string {
  return text.normalize("NFD").replace(/\p{Mn}+/gu, "");
}

/** `text`'s tokens, each replaced by its stem, in order — what an engine must
 * index ALONGSIDE the literal text for {@link SearchQueryTerm.stem} to find
 * anything. Order and repetition are preserved rather than deduped, so a
 * stemmed field has the same length and term frequencies as the literal field
 * it shadows and bm25 ranks the two the same way.
 *
 * A SHADOW rather than a replacement, for two measured reasons.
 *
 * Stemming the indexed text in place breaks the search box's own interaction:
 * the token still being typed is matched by PREFIX, and a prefix run against
 * stems stops matching the moment it reaches into the suffix — `hirin`,
 * `packin`, `migratio` and `runn` all go dead against an index holding `hire`,
 * `pack`, `migrat` and `run`. Measured over the labelled corpus, 86 of the
 * 1,555 prefixes that retrieve something stop retrieving anything (5.5%). So
 * the literal text stays indexed and owns prefix matching, and the stems own
 * whole-word matching.
 *
 * It is also why FTS5's own `porter` tokenizer is not what the SQL store uses,
 * though it would otherwise be the idiomatic answer: it stems the index, which
 * is exactly the case above, and it would move half of this policy into
 * SQLite's C where the pure engine cannot execute the same one.
 *
 * The stemmer is English. A token it has no rule for comes back unchanged, so
 * a vault in another language searches exactly as it does today. */
export function stemText(text: string): string {
  return tokenize(text).map(stemmer).join(" ");
}

/** One token to look up: `stem` is what a whole-word match asks for, `token`
 * is what a prefix match asks for, and `prefix` says which of the two this
 * term is. */
export type SearchQueryTerm = { token: string; stem: string; prefix: boolean };

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
    stem: stemmer(token),
    prefix: token === typing,
  }));

  if (content.length > CONJUNCTION_MAX_TERMS) return [{ terms, match: "any" }];
  if (content.length < RELAXABLE_MIN_TERMS) return [{ terms, match: "all" }];
  return [
    { terms, match: "all" },
    { terms, match: "any" },
  ];
}
