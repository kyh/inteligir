// ---------------------------------------------------------------------------
// Lexical full-text index with title/heading/body tiering. Hand-rolled
// inverted index rather than a search dependency: the vault caps at 2000
// files (VaultManager MAX_LIST_ENTRIES), the ranking must be deterministic
// and tier-exact for tests, and the same class runs in node (host) and the
// browser (dev-harness fixture bridge) with zero install weight. At this
// scale a library buys nothing but drift.
//
// Model: token → doc → per-field term frequencies. Queries AND across tokens
// (every token must hit somewhere in the doc); the final token also matches
// by prefix so search-as-you-type works. Scoring is weighted, capped tf —
// caps keep a body-spammy doc from drowning a title match.
// ---------------------------------------------------------------------------

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
/** Prefix matches (last query token) score below exact matches. */
const PREFIX_FACTOR = 0.7;

/** Unicode-aware tokens: letter/number/underscore runs, lowercased. */
export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [];
}

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

  set(path: string, fields: SearchFields): void {
    this.remove(path);
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
  }

  clear(): void {
    this.postings.clear();
    this.docTokens.clear();
  }

  /** Ranked hits: AND across query tokens, last token prefix-matches. */
  search(query: string, limit: number): SearchHit[] {
    const tokens = [...new Set(tokenize(query))];
    if (tokens.length === 0) return [];

    // Per-token doc → best contribution; a doc survives only if present for
    // every token.
    let surviving: Map<string, number> | null = null;
    for (const [i, token] of tokens.entries()) {
      const isLast = i === tokens.length - 1;
      const contributions = new Map<string, number>();
      const exact = this.postings.get(token);
      if (exact) {
        for (const [path, counts] of exact) contributions.set(path, weightOf(counts));
      }
      if (isLast) {
        for (const [candidate, docs] of this.postings) {
          if (candidate === token || !candidate.startsWith(token)) continue;
          for (const [path, counts] of docs) {
            const scored = PREFIX_FACTOR * weightOf(counts);
            const prior = contributions.get(path);
            if (prior === undefined || scored > prior) contributions.set(path, scored);
          }
        }
      }
      if (surviving === null) {
        surviving = contributions;
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
}
