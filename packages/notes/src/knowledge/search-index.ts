// ---------------------------------------------------------------------------
// Lexical full-text index with title/heading/body tiering — the pure,
// zero-dependency in-memory reference engine inside KnowledgeIndex. The
// production surfaces search through the SQL KnowledgeStore's FTS5 instead
// (bm25 with the same 10/4/1 field weights, sql-knowledge-store.ts); this
// class stays as the deterministic, tier-exact behavioral pin (core tests)
// and the drop-in for any surface that can't carry a SQLite binding.
//
// Model: TWO posting tables over the same docs — one keyed by the literal
// token, one by its stem — each mapping doc → per-field term frequencies. The
// split mirrors the SQL store's literal columns and their stem shadow, and for
// the same reason: a term still being typed prefix-matches the literal table,
// where the letters the user has actually typed still start a word, while a
// settled term asks the stems. Which tokens a query asks for, which of them
// are stems, and whether they are all required is search-query.ts's answer for
// both engines; this file only executes it. Scoring is weighted, capped tf —
// caps keep a body-spammy doc from drowning a title match, and under "any"
// they are also what makes a doc matching more terms outrank one matching
// fewer.
// ---------------------------------------------------------------------------

import {
  planSearchQuery,
  tokenize,
  type SearchQueryPlan,
  type SearchQueryTerm,
} from "./search-query";
import { stemmer } from "stemmer";

export type SearchFields = {
  title: string;
  headings: readonly string[];
  body: string;
};

export type SearchHit = { path: string; score: number };

type FieldCounts = { title: number; heading: number; body: number };

const TITLE_WEIGHT = 10;
const HEADING_WEIGHT = 4;
const BODY_WEIGHT = 1;
/** Per-field tf cap — bounded so max body contribution (5) < one title hit. */
const TF_CAP = 5;
/** Prefix matches (the token still being typed) score below exact matches. */
const PREFIX_FACTOR = 0.7;

function weightOf(counts: FieldCounts): number {
  return (
    TITLE_WEIGHT * Math.min(counts.title, TF_CAP) +
    HEADING_WEIGHT * Math.min(counts.heading, TF_CAP) +
    BODY_WEIGHT * Math.min(counts.body, TF_CAP)
  );
}

type Postings = Map<string, Map<string, FieldCounts>>;

function bump(postings: Postings, key: string, path: string, field: keyof FieldCounts): void {
  let docs = postings.get(key);
  if (!docs) {
    docs = new Map();
    postings.set(key, docs);
  }
  let counts = docs.get(path);
  if (!counts) {
    counts = { title: 0, heading: 0, body: 0 };
    docs.set(path, counts);
  }
  counts[field] += 1;
}

function drop(postings: Postings, keys: ReadonlySet<string>, path: string): void {
  for (const key of keys) {
    const docs = postings.get(key);
    if (!docs) continue;
    docs.delete(path);
    if (docs.size === 0) postings.delete(key);
  }
}

/** What one doc put into each table, so removing it is a bounded walk. */
type DocKeys = { tokens: Set<string>; stems: Set<string> };

export class SearchIndex {
  private readonly postings: Postings = new Map();
  private readonly stemPostings: Postings = new Map();
  private readonly docKeys = new Map<string, DocKeys>();
  /** Sorted `postings` keys for range-scanned prefix expansion; `null` when a
   * mutation may have changed the key set — rebuilt lazily on first search.
   * Literal keys only: prefix matching never reads the stems. */
  private sortedTokens: string[] | null = null;

  set(path: string, fields: SearchFields): void {
    this.remove(path);
    this.sortedTokens = null;
    const keys: DocKeys = { tokens: new Set(), stems: new Set() };
    const add = (field: keyof FieldCounts, text: string): void => {
      for (const token of tokenize(text)) {
        bump(this.postings, token, path, field);
        keys.tokens.add(token);
        const stem = stemmer(token);
        bump(this.stemPostings, stem, path, field);
        keys.stems.add(stem);
      }
    };
    add("title", fields.title);
    for (const heading of fields.headings) add("heading", heading);
    add("body", fields.body);
    this.docKeys.set(path, keys);
  }

  remove(path: string): void {
    const keys = this.docKeys.get(path);
    if (!keys) return;
    drop(this.postings, keys.tokens, path);
    drop(this.stemPostings, keys.stems, path);
    this.docKeys.delete(path);
    this.sortedTokens = null;
  }

  clear(): void {
    this.postings.clear();
    this.stemPostings.clear();
    this.docKeys.clear();
    this.sortedTokens = null;
  }

  /** First index into `sorted` whose key is `>= token` (lower bound). */
  private static lowerBound(sorted: readonly string[], token: string): number {
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      const v = sorted[mid];
      if (v !== undefined && v < token) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  /** Ranked hits for the query — see search-query.ts for which tokens are
   * asked for, whether all of them are required, and why a plan that matches
   * nothing is followed by a relaxed one. */
  search(query: string, limit: number): SearchHit[] {
    for (const plan of planSearchQuery(query)) {
      const hits = this.run(plan, limit);
      if (hits.length > 0) return hits;
    }
    return [];
  }

  private run(plan: SearchQueryPlan, limit: number): SearchHit[] {
    // doc → summed contribution. Under "all" a doc that misses a term is
    // dropped from the running set; under "any" it simply scores less than
    // the docs that matched more terms.
    let surviving: Map<string, number> | null = null;
    for (const term of plan.terms) {
      const contributions = this.contributionsFor(term);
      if (surviving === null) {
        surviving = contributions;
        continue;
      }
      if (plan.match === "any") {
        for (const [path, score] of contributions) {
          surviving.set(path, (surviving.get(path) ?? 0) + score);
        }
        continue;
      }
      const next = new Map<string, number>();
      for (const [path, score] of contributions) {
        const prior = surviving.get(path);
        if (prior !== undefined) next.set(path, prior + score);
      }
      surviving = next;
      if (surviving.size === 0) return [];
    }
    if (surviving === null) return [];

    return [...surviving.entries()]
      .map(([path, score]) => ({ path, score }))
      .toSorted((a, b) => b.score - a.score || (a.path < b.path ? -1 : 1))
      .slice(0, limit);
  }

  /** Every doc one term reaches, scored. Whatever shares the term's stem
   * always counts — that is the whole-word match, and it subsumes the literal
   * token, whose own stem is this one. A term still being TYPED additionally
   * reaches whatever merely STARTS with the letters typed so far, at a
   * discount. Best contribution per doc wins; the term is one term either
   * way. */
  private contributionsFor(term: SearchQueryTerm): Map<string, number> {
    const contributions = new Map<string, number>();
    const keep = (path: string, score: number): void => {
      const prior = contributions.get(path);
      if (prior === undefined || score > prior) contributions.set(path, score);
    };
    const stemmed = this.stemPostings.get(term.stem);
    if (stemmed) {
      for (const [path, counts] of stemmed) keep(path, weightOf(counts));
    }
    if (!term.prefix) return contributions;
    // Range-scan just the keys sharing this prefix: sorted keys make the
    // prefix span a contiguous block from the lower bound, so walk it and
    // stop at the first non-match instead of iterating every posting.
    if (this.sortedTokens === null) this.sortedTokens = [...this.postings.keys()].toSorted();
    const sorted = this.sortedTokens;
    for (let idx = SearchIndex.lowerBound(sorted, term.token); idx < sorted.length; idx++) {
      const candidate = sorted[idx];
      if (candidate === undefined || !candidate.startsWith(term.token)) break;
      const docs = this.postings.get(candidate);
      if (!docs) continue;
      for (const [path, counts] of docs) keep(path, PREFIX_FACTOR * weightOf(counts));
    }
    return contributions;
  }
}
