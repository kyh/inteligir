// ---------------------------------------------------------------------------
// Oracle-equivalence tests for the perf-shaped code paths (plan 011). Not
// timing tests: each pins the optimized implementation against a brute-force
// reference copied from the pre-optimization code, over deterministic
// synthetic corpora large enough to exercise bucket/range logic broadly.
//   (a) link-resolve Tier 3 — basename-bucket suffix matching must equal the
//       old full-listing scan for every input.
//   (b) search prefix expansion — the sorted-token range scan must equal the
//       old full-postings iteration, including across mutations that
//       invalidate the lazily rebuilt sorted key array.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { buildResolver } from "../knowledge/link-resolve";
import { SearchIndex, tokenize } from "../knowledge/search-index";
import type { SearchFields, SearchHit } from "../knowledge/search-index";
import { basenamePath, extnamePath, normalizePath } from "../knowledge/vault-path";

/** Deterministic PRNG (mulberry32) — the corpora must be reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rand() * items.length)];
  if (item === undefined) throw new Error("pick from empty list");
  return item;
}

// ---------------------------------------------------------------------------
// (a) Resolver oracle — the documented algorithm with the ORIGINAL full-scan
// tiers (linear filters over the whole listing; no basename buckets).
// ---------------------------------------------------------------------------

/** Copy of the resolver's deterministic ambiguity break. */
function pickBest(candidates: readonly string[]): string | null {
  if (candidates.length === 0) return null;
  let best: string | null = null;
  let bestSegments = Number.POSITIVE_INFINITY;
  for (const path of candidates) {
    const segments = path.split("/").length;
    if (
      best === null ||
      segments < bestSegments ||
      (segments === bestSegments &&
        (path.length < best.length || (path.length === best.length && path < best)))
    ) {
      best = path;
      bestSegments = segments;
    }
  }
  return best;
}

/** Basename-or-md-stem match, mirroring how byName buckets are keyed. */
function nameMatches(p: string, name: string): boolean {
  const base = basenamePath(p);
  if (base === name) return true;
  return extnamePath(base).toLowerCase() === ".md" && base.slice(0, -3) === name;
}

/** Brute-force reference resolveWiki over the full listing. Tier 3 is the
 * pre-optimization code verbatim (suffix filters over every path). */
function oracleResolveWiki(all: readonly string[], target: string): string | null {
  const clean = normalizePath(target);
  if (clean === "" || clean.startsWith("..")) return null;

  // Tier 1 — exact path (as written, then with `.md` implied), cs then ci.
  for (const candidate of [clean, `${clean}.md`]) {
    if (all.includes(candidate)) return candidate;
    const lower = candidate.toLowerCase();
    const ci = pickBest(all.filter((p) => p.toLowerCase() === lower));
    if (ci !== null) return ci;
  }

  if (!clean.includes("/")) {
    // Tier 2 — basename / stem, cs then ci.
    const cs = pickBest(all.filter((p) => nameMatches(p, clean)));
    if (cs !== null) return cs;
    const lower = clean.toLowerCase();
    return pickBest(all.filter((p) => nameMatches(p.toLowerCase(), lower)));
  }

  // Tier 3 — path suffix (the original full-`all` scan).
  const suffixes = [`/${clean}`, `/${clean}.md`];
  const cs = pickBest(all.filter((p) => suffixes.some((s) => p.endsWith(s))));
  if (cs !== null) return cs;
  const lowerSuffixes = suffixes.map((s) => s.toLowerCase());
  return pickBest(all.filter((p) => lowerSuffixes.some((s) => p.toLowerCase().endsWith(s))));
}

function buildSyntheticVault(rand: () => number, count: number): string[] {
  const dirs = ["", "notes", "wiki", "projects/alpha", "projects/beta", "Deep/Nested/Dir", "sub"];
  const stems = ["note", "Note", "roadmap", "digest", "Plan", "tasks", "readme", "Ideas"];
  const exts = [".md", ".md", ".md", ".png", ".txt"];
  const seen = new Set<string>();
  const paths: string[] = [];
  while (paths.length < count) {
    const dir = pick(rand, dirs);
    const stem = `${pick(rand, stems)}${Math.floor(rand() * 400)}`;
    const ext = pick(rand, exts);
    const path = dir === "" ? `${stem}${ext}` : `${dir}/${stem}${ext}`;
    if (seen.has(path)) continue;
    seen.add(path);
    paths.push(path);
  }
  return paths;
}

function caseMangle(rand: () => number, s: string): string {
  if (rand() < 0.5) return s.toLowerCase();
  if (rand() < 0.5) return s.toUpperCase();
  return s;
}

describe("link-resolve — bucket Tier 3 equals the full-scan oracle", () => {
  // ~5s of CPU when the machine is contended (the full monorepo test run) —
  // the default 5s per-test timeout is too tight for it.
  it("matches on 1,000 path-style targets over 5,000 synthetic paths", { timeout: 20_000 }, () => {
    const rand = mulberry32(0xc0ffee);
    const paths = buildSyntheticVault(rand, 5000);
    const resolver = buildResolver(paths);

    for (let i = 0; i < 1000; i++) {
      const source = pick(rand, paths);
      const segments = source.split("/");
      // Path-style target: the last 1–3 segments of a real path.
      const take = Math.min(segments.length, 1 + Math.floor(rand() * 3));
      let target = segments.slice(segments.length - take).join("/");
      // Cover the `.md` and extension-less spellings.
      if (target.endsWith(".md") && rand() < 0.5) target = target.slice(0, -3);
      // Cover case variants.
      if (rand() < 0.4) target = caseMangle(rand, target);
      // Cover misses.
      if (rand() < 0.1) target = `missing-dir/${target}`;

      expect(resolver.resolveWiki(target), `target: ${JSON.stringify(target)}`).toBe(
        oracleResolveWiki(paths, target),
      );
    }
  });

  it("matches on handcrafted Tier-3 edge shapes", () => {
    const paths = [
      "a/sub/note.md",
      "b/sub/note.md",
      "c/deep/sub/note.md",
      "x/Sub/Note.md",
      "y/sub/note.png",
      "z/sub/note.md.md",
      "sub/note.md",
    ];
    const resolver = buildResolver(paths);
    const targets = [
      "sub/note",
      "sub/note.md",
      "Sub/Note",
      "SUB/NOTE.MD",
      "sub/note.png",
      "sub/note.md.md",
      "deep/sub/note",
      "nope/note",
      "sub/missing",
    ];
    for (const target of targets) {
      expect(resolver.resolveWiki(target), `target: ${JSON.stringify(target)}`).toBe(
        oracleResolveWiki(paths, target),
      );
    }
  });
});

// ---------------------------------------------------------------------------
// (b) Search oracle — the ORIGINAL search() with the full-postings iteration
// in the last-token prefix branch, over a reference postings map.
// ---------------------------------------------------------------------------

type FieldCounts = { title: number; heading: number; body: number };

const TITLE_WEIGHT = 10;
const HEADING_WEIGHT = 4;
const BODY_WEIGHT = 1;
const TF_CAP = 5;
const PREFIX_FACTOR = 0.7;

function weightOf(counts: FieldCounts): number {
  return (
    TITLE_WEIGHT * Math.min(counts.title, TF_CAP) +
    HEADING_WEIGHT * Math.min(counts.heading, TF_CAP) +
    BODY_WEIGHT * Math.min(counts.body, TF_CAP)
  );
}

/** Reference postings built the same way SearchIndex.set builds them. */
class OracleIndex {
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

  /** The pre-optimization search: full iteration over every posting key in
   * the last-token prefix branch. */
  search(query: string, limit: number): SearchHit[] {
    const tokens = [...new Set(tokenize(query))];
    if (tokens.length === 0) return [];

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

const WORDS = [
  "alpha",
  "alphabet",
  "alpine",
  "beta",
  "betray",
  "gamma",
  "game",
  "gamut",
  "delta",
  "delete",
  "note",
  "notes",
  "notebook",
  "nothing",
  "roadmap",
  "road",
  "sync",
  "synchronize",
  "syntax",
  "zeta",
];

function syntheticFields(rand: () => number): SearchFields {
  const sentence = (n: number): string =>
    Array.from({ length: n }, () => pick(rand, WORDS)).join(" ");
  return {
    title: sentence(1 + Math.floor(rand() * 3)),
    headings: Array.from({ length: Math.floor(rand() * 3) }, () =>
      sentence(1 + Math.floor(rand() * 2)),
    ),
    body: sentence(5 + Math.floor(rand() * 30)),
  };
}

const QUERIES = [
  "al",
  "alp",
  "alpha",
  "alphab",
  "b",
  "bet",
  "gam",
  "game",
  "not",
  "note",
  "notes",
  "noteb",
  "road",
  "roadm",
  "syn",
  "sync",
  "z",
  "zet",
  "q",
  "missing",
  "alpha bet",
  "note road",
  "gamma not",
  "sync alpha gam",
  "alpha alpha",
];

describe("search — range-scanned prefix expansion equals the full-iteration oracle", () => {
  it("matches on every query over a synthetic corpus, across mutations", () => {
    const rand = mulberry32(0x5eed);
    const index = new SearchIndex();
    const oracle = new OracleIndex();

    const docs: string[] = [];
    for (let i = 0; i < 400; i++) {
      const path = `doc-${i}.md`;
      const fields = syntheticFields(rand);
      index.set(path, fields);
      oracle.set(path, fields);
      docs.push(path);
    }

    const compareAll = (): void => {
      for (const query of QUERIES) {
        expect(index.search(query, 25), `query: ${JSON.stringify(query)}`).toEqual(
          oracle.search(query, 25),
        );
        // A second search with no mutation in between exercises the cached
        // sorted-token array.
        expect(index.search(query, 5), `query (cached): ${JSON.stringify(query)}`).toEqual(
          oracle.search(query, 5),
        );
      }
    };

    compareAll();

    // Mutate — re-set some docs, remove others — and compare again so the
    // lazily rebuilt sorted key array is exercised after invalidation.
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 40; i++) {
        const path = pick(rand, docs);
        if (rand() < 0.3) {
          index.remove(path);
          oracle.remove(path);
        } else {
          const fields = syntheticFields(rand);
          index.set(path, fields);
          oracle.set(path, fields);
        }
      }
      compareAll();
    }
  });

  it("matches when a mutation removes the last doc of a prefix token", () => {
    const index = new SearchIndex();
    const oracle = new OracleIndex();
    index.set("a.md", { title: "alpha", headings: [], body: "" });
    index.set("b.md", { title: "alphabet", headings: [], body: "" });
    oracle.set("a.md", { title: "alpha", headings: [], body: "" });
    oracle.set("b.md", { title: "alphabet", headings: [], body: "" });
    expect(index.search("alp", 10)).toEqual(oracle.search("alp", 10));
    index.remove("b.md");
    oracle.remove("b.md");
    expect(index.search("alp", 10)).toEqual(oracle.search("alp", 10));
    expect(index.search("alphab", 10)).toEqual(oracle.search("alphab", 10));
  });
});
