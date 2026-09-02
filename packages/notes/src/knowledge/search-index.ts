// The in-memory engine beside the SQL store's FTS5: search-query.ts decides what
// both ask for, and the field weights and tiers here must match sql-knowledge-store's.

import {
  planSearchQuery,
  stemToken,
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
// the max body contribution (5) stays below one title hit
const TF_CAP = 5;
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

type DocKeys = { tokens: Set<string>; stems: Set<string> };

export class SearchIndex {
  private readonly postings: Postings = new Map();
  private readonly stemPostings: Postings = new Map();
  private readonly docKeys = new Map<string, DocKeys>();
  // literal keys only: prefix matching never reads the stems
  private sortedTokens: string[] | null = null;

  set(path: string, fields: SearchFields): void {
    this.remove(path);
    this.sortedTokens = null;
    const keys: DocKeys = { tokens: new Set(), stems: new Set() };
    const add = (field: keyof FieldCounts, text: string): void => {
      for (const token of tokenize(text)) {
        bump(this.postings, token, path, field);
        keys.tokens.add(token);
        const stem = stemToken(token);
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

  search(query: string, limit: number): SearchHit[] {
    for (const plan of planSearchQuery(query)) {
      const hits = this.run(plan, limit);
      if (hits.length > 0) return hits;
    }
    return [];
  }

  private run(plan: SearchQueryPlan, limit: number): SearchHit[] {
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

  // a doc holding the literal word counts again on top of its stem, and that is the exact
  // tier, not a double-count: porter maps `busy` and `business` both to `busi`, so without
  // it a note titled "Busy" outranks one whose body says `business`. the sql store sums the same way
  private contributionsFor(term: SearchQueryTerm): Map<string, number> {
    const contributions = new Map<string, number>();
    const add = (path: string, score: number): void => {
      contributions.set(path, (contributions.get(path) ?? 0) + score);
    };
    const keep = (path: string, score: number): void => {
      const prior = contributions.get(path);
      if (prior === undefined || score > prior) contributions.set(path, score);
    };
    const stemmed = this.stemPostings.get(term.stem);
    if (stemmed) {
      for (const [path, counts] of stemmed) add(path, weightOf(counts));
    }
    const exact = this.postings.get(term.token);
    if (exact) {
      for (const [path, counts] of exact) add(path, weightOf(counts));
    }
    if (!term.prefix) return contributions;
    if (this.sortedTokens === null) this.sortedTokens = [...this.postings.keys()].toSorted();
    const sorted = this.sortedTokens;
    for (let idx = SearchIndex.lowerBound(sorted, term.token); idx < sorted.length; idx++) {
      const candidate = sorted[idx];
      if (candidate === undefined || !candidate.startsWith(term.token)) break;
      // the token itself was counted at full weight above
      if (candidate === term.token) continue;
      const docs = this.postings.get(candidate);
      if (!docs) continue;
      for (const [path, counts] of docs) keep(path, PREFIX_FACTOR * weightOf(counts));
    }
    return contributions;
  }
}
