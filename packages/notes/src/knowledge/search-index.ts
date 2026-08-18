// ---------------------------------------------------------------------------
// Lexical full-text index with title/heading/body tiering — the pure,
// zero-dependency in-memory reference engine inside KnowledgeIndex. The
// production surfaces search through the SQL KnowledgeStore's FTS5 instead
// (bm25 with the same 10/4/1 field weights, sql-knowledge-store.ts); this
// class stays as the deterministic, tier-exact behavioral pin (core tests)
// and the drop-in for any surface that can't carry a SQLite binding.
//
// Model: token → doc → per-field term frequencies. Which tokens a query asks
// for, and whether they are all required, is search-query.ts's answer for both
// engines; this file only executes it. Scoring is weighted, capped tf — caps
// keep a body-spammy doc from drowning a title match, and under "any" they are
// also what makes a doc matching more terms outrank one matching fewer.
// ---------------------------------------------------------------------------

import {
  planSearchQuery,
  tokenize,
  type SearchQueryPlan,
  type SearchQueryTerm,
} from "./search-query";

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

export class SearchIndex {
  private readonly postings = new Map<string, Map<string, FieldCounts>>();
  private readonly docTokens = new Map<string, Set<string>>();
  /** Sorted `postings` keys for range-scanned prefix expansion; `null` when a
   * mutation may have changed the key set — rebuilt lazily on first search. */
  private sortedTokens: string[] | null = null;

  set(path: string, fields: SearchFields): void {
    this.remove(path);
    this.sortedTokens = null;
    const tokens = new Set<string>();
    const add = (field: keyof FieldCounts, text: string): void => {
      for (const token of tokenize(text)) {
        let docs = this.postings.get(token);
        if (!docs) {
          docs = new Map();
          this.postings.set(token, docs);
        }
        let counts = docs.get(path);
        if (!counts) {
          counts = { title: 0, heading: 0, body: 0 };
          docs.set(path, counts);
        }
        counts[field] += 1;
        tokens.add(token);
      }
    };
    add("title", fields.title);
    for (const heading of fields.headings) add("heading", heading);
    add("body", fields.body);
    this.docTokens.set(path, tokens);
  }

  remove(path: string): void {
    const tokens = this.docTokens.get(path);
    if (!tokens) return;
    for (const token of tokens) {
      const docs = this.postings.get(token);
      if (!docs) continue;
      docs.delete(path);
      if (docs.size === 0) this.postings.delete(token);
    }
    this.docTokens.delete(path);
    this.sortedTokens = null;
  }

  clear(): void {
    this.postings.clear();
    this.docTokens.clear();
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

  /** Every doc one term reaches, scored — exact hits, plus prefix hits at a
   * discount when the term is the one still being typed. */
  private contributionsFor(term: SearchQueryTerm): Map<string, number> {
    const contributions = new Map<string, number>();
    const exact = this.postings.get(term.token);
    if (exact) {
      for (const [path, counts] of exact) contributions.set(path, weightOf(counts));
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
      if (candidate === term.token) continue;
      const docs = this.postings.get(candidate);
      if (!docs) continue;
      for (const [path, counts] of docs) {
        const scored = PREFIX_FACTOR * weightOf(counts);
        const prior = contributions.get(path);
        if (prior === undefined || scored > prior) contributions.set(path, scored);
      }
    }
    return contributions;
  }
}
