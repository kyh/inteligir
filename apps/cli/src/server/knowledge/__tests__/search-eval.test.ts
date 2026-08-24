// ---------------------------------------------------------------------------
// The search evaluation harness — issue #570 stage 3.
//
// It exists to turn "how much of vault retrieval is still broken" into a
// number, because every stage after this one (a reranker, an embedding index,
// a model download, a second cache) is only worth its cost if the RESIDUE
// justifies it. Run it and read the report:
//
//   pnpm --filter @repo/app vitest run src/node/knowledge/__tests__/search-eval
//
// It scores the labelled corpus in search-eval-vault.ts three times — under
// the AND-every-token expression this repo shipped before stage 1, under the
// relaxed plan with no stemming, and under what it ships now — over the REAL
// store, so the numbers are FTS5's and bm25's rather than a model of them.
// Each column is one policy's whole contribution, which is the point: a stage
// that does not move these numbers is not worth its weight.
//
// Every miss that survives is then classified by asking the one question that
// decides which stage could fix it: is the note retrievable AT ALL? A note the
// engine returns at rank 30 is a RANKING miss, and reranking is exactly the
// thing that moves it. A note no lexical query reaches, because the words are
// simply not in it, is a VOCABULARY miss — and that class is the whole
// argument for an embedding index. Counting them apart is the finding; the
// harness has no opinion about what to do with it.
// ---------------------------------------------------------------------------

import { createHash } from "node:crypto";
import { join } from "node:path";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { projectDoc } from "@repo/notes/knowledge/projection";
import {
  createSqlKnowledgeStore,
  type SqlDriver,
  type SqlKnowledgeStore,
} from "@repo/notes/knowledge/sql-knowledge-store";
import { planSearchQuery, type SearchQueryPlan } from "@repo/notes/knowledge/search-query";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";
import { EVAL_QUERIES, EVAL_VAULT, type EvalQuery } from "./search-eval-vault";
import { z } from "zod";

/** The result window a person actually looks at. */
const K = 10;
/** Wider than the corpus, so "found here" means "reachable at all". */
const REACHABLE = 200;

// ---- The two policies ---------------------------------------------------------

/** What a search policy answers: ranked paths, best first. */
type Retrieve = (query: string, limit: number) => string[];

/** The expression this repo shipped BEFORE stage 1: every token quoted and
 * ANDed, the last one prefix-matched. Frozen — it is the baseline the report
 * measures against, so it must stay what shipped rather than track what the
 * store does now. The tokenizer is inlined for the same reason. */
function legacyMatchExpression(query: string): string | null {
  const tokens = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];
  if (tokens.length === 0) return null;
  return tokens
    .map((token, i) => (i === tokens.length - 1 ? `"${token}" *` : `"${token}"`))
    .join(" ");
}

/** The relaxed plan rendered over the LITERAL columns only — stage 1 without
 * the stem shadow. The literal columns are still indexed, so the intermediate
 * stays RUNNABLE rather than becoming a number in an old commit message, and
 * what stemming bought is a column of this report instead of a claim. */
function unstemmedMatchExpression(plan: SearchQueryPlan): string {
  return plan.terms
    .map((term) => `{title headings body}: "${term.token}"${term.prefix ? " *" : ""}`)
    .join(plan.match === "all" ? " AND " : " OR ");
}

/** The store's own ranked read, copied for the columns the store cannot run —
 * it builds its expression internally, so neither the old expression nor the
 * unstemmed one can go through it. Same bm25 field weights, so every column is
 * comparable; the stem weights are inert for both, which have no stem term. */
const PROBE_SEARCH_SQL = `
SELECT path, bm25(search_fts, 10.0, 4.0, 1.0, 10.0, 4.0, 1.0) AS rank
FROM search_fts WHERE search_fts MATCH ?
ORDER BY rank, path LIMIT ?
`;

// ---- Metrics ------------------------------------------------------------------

type Metrics = {
  /** Queries with at least one correct note in the top K. */
  answered: number;
  recall: number;
  /** The top hit is a correct note. */
  precisionAt1: number;
  /** Correct notes per K slots — its ceiling is the mean gold-set size / K
   * (0.11 here), so read it as a noise gauge, not as a percentage. */
  precisionAtK: number;
  mrr: number;
  /** Mean results returned — what the disjunction costs in tail. */
  meanResults: number;
};

function scoreOne(retrieved: string[], gold: readonly string[]) {
  const top = retrieved.slice(0, K);
  const goldSet = new Set(gold);
  const found = top.filter((path) => goldSet.has(path));
  const firstHit = top.findIndex((path) => goldSet.has(path));
  return {
    answered: found.length > 0 ? 1 : 0,
    recall: found.length / gold.length,
    precisionAt1: top[0] !== undefined && goldSet.has(top[0]) ? 1 : 0,
    precisionAtK: found.length / K,
    mrr: firstHit < 0 ? 0 : 1 / (firstHit + 1),
    meanResults: retrieved.length,
  };
}

/** Every metric the table averages — `Object.keys` would only answer `string`. */
const METRIC_KEYS = [
  "answered",
  "recall",
  "precisionAt1",
  "precisionAtK",
  "mrr",
  "meanResults",
] as const satisfies readonly (keyof Metrics)[];

function measure(retrieve: Retrieve, queries: readonly EvalQuery[]): Metrics {
  const totals: Metrics = {
    answered: 0,
    recall: 0,
    precisionAt1: 0,
    precisionAtK: 0,
    mrr: 0,
    meanResults: 0,
  };
  for (const { query, gold } of queries) {
    const one = scoreOne(retrieve(query, K), gold);
    for (const key of METRIC_KEYS) totals[key] += one[key];
  }
  for (const key of METRIC_KEYS) totals[key] /= queries.length;
  return totals;
}

function pct(value: number): string {
  return `${(value * 100).toFixed(0).padStart(3)}%`;
}

function formatMetrics(label: string, metrics: Metrics): string {
  return [
    label.padEnd(10),
    `answered ${pct(metrics.answered)}`,
    `recall@${K} ${pct(metrics.recall)}`,
    `P@1 ${pct(metrics.precisionAt1)}`,
    `P@${K} ${pct(metrics.precisionAtK)}`,
    `MRR ${metrics.mrr.toFixed(2)}`,
    `results ${metrics.meanResults.toFixed(1)}`,
  ].join("  ");
}

// ---- The corpus, indexed by both engines --------------------------------------

let driver: SqlDriver;
let store: SqlKnowledgeStore;
let pure: KnowledgeIndex;

beforeAll(() => {
  driver = createSqliteDriver(join(makeTempDir("inteligir-search-eval-"), "knowledge.db"));
  store = createSqlKnowledgeStore(driver, "/vault");
  pure = new KnowledgeIndex();
  for (const [path, content] of Object.entries(EVAL_VAULT)) {
    store.upsertDoc(
      {
        path,
        contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
        projection: projectDoc(path, content),
      },
      content,
    );
    pure.setDoc(path, content);
  }
});

afterAll(() => {
  store.dispose();
  for (const built of tierStores.splice(0)) built.dispose();
});

function probe(match: string, limit: number): string[] {
  return driver.all(PROBE_SEARCH_SQL, [match, limit]).map((row) => {
    const path = z.string().safeParse(row.path);
    return path.success ? path.data : "";
  });
}

const before: Retrieve = (query, limit) => {
  const match = legacyMatchExpression(query);
  return match === null ? [] : probe(match, limit);
};

/** The plan ladder the store runs, rendered without the stems: the FIRST plan
 * that matches anything is the answer, exactly as the store decides it. */
const unstemmed: Retrieve = (query, limit) => {
  for (const plan of planSearchQuery(query)) {
    const rows = probe(unstemmedMatchExpression(plan), limit);
    if (rows.length > 0) return rows;
  }
  return [];
};

const after: Retrieve = (query, limit) => store.search(query, limit).map((hit) => hit.path);

/** A throwaway store over exactly the notes one invariant needs. Each of these
 * corpora is built to expose a ranking relation, so they are kept APART: a
 * shared fixture lets a note added for one test change another's answer. */
function storeOf(docs: Readonly<Record<string, string>>): SqlKnowledgeStore {
  const built = createSqlKnowledgeStore(
    createSqliteDriver(join(makeTempDir("inteligir-search-tier-"), "knowledge.db")),
    "/vault",
  );
  tierStores.push(built);
  for (const [path, content] of Object.entries(docs)) {
    built.upsertDoc(
      {
        path,
        contentHash: createHash("sha256").update(content, "utf8").digest("hex"),
        projection: projectDoc(path, content),
      },
      content,
    );
  }
  return built;
}

/** The same corpus in the pure engine, so a relation can be asserted of both. */
function pureOf(docs: Readonly<Record<string, string>>): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(docs)) index.setDoc(path, content);
  return index;
}

const tierStores: SqlKnowledgeStore[] = [];

/** Every note the current policy can reach for this query, at any rank. */
function reachable(query: string): Set<string> {
  return new Set(after(query, REACHABLE));
}

type Miss = { query: string; gold: readonly string[]; kind: "ranking" | "vocabulary" };

function misses(retrieve: Retrieve): Miss[] {
  const out: Miss[] = [];
  for (const { query, gold } of EVAL_QUERIES) {
    const top = new Set(retrieve(query, K));
    const missing = gold.filter((path) => !top.has(path));
    if (missing.length === 0) continue;
    const within = reachable(query);
    out.push({
      query,
      gold: missing,
      kind: missing.some((path) => within.has(path)) ? "ranking" : "vocabulary",
    });
  }
  return out;
}

// ---- The report ---------------------------------------------------------------

describe("vault search — the retrieval measurement", () => {
  it("reports what each policy bought, and what it left behind", () => {
    const beforeMetrics = measure(before, EVAL_QUERIES);
    const unstemmedMetrics = measure(unstemmed, EVAL_QUERIES);
    const afterMetrics = measure(after, EVAL_QUERIES);
    const residue = misses(after);
    const vocabulary = residue.filter((miss) => miss.kind === "vocabulary");
    const ranking = residue.filter((miss) => miss.kind === "ranking");

    const lines = [
      "",
      `search eval — ${Object.keys(EVAL_VAULT).length} notes, ${EVAL_QUERIES.length} labelled queries`,
      formatMetrics("before", beforeMetrics),
      formatMetrics("relaxed", unstemmedMetrics),
      formatMetrics("stemmed", afterMetrics),
      `residue: ${residue.length}/${EVAL_QUERIES.length} queries still miss a note` +
        ` — ${vocabulary.length} vocabulary, ${ranking.length} ranking`,
      ...residue.map(
        (miss) => `  ${miss.kind.padEnd(10)} "${miss.query}" → ${miss.gold.join(", ")}`,
      ),
      "",
    ];
    console.log(lines.join("\n"));

    // Relaxing the query is only worth doing if it retrieves more, and only
    // safe if it does not do it by returning everything.
    expect(unstemmedMetrics.answered).toBeGreaterThan(beforeMetrics.answered);
    expect(unstemmedMetrics.recall).toBeGreaterThan(beforeMetrics.recall);
    expect(unstemmedMetrics.mrr).toBeGreaterThan(beforeMetrics.mrr);
    expect(afterMetrics.meanResults).toBeLessThan(Object.keys(EVAL_VAULT).length / 2);

    // And the stem shadow is only worth its column of the index if it recalls
    // more than the same plan without it. A null result here is the finding.
    expect(afterMetrics.recall).toBeGreaterThan(unstemmedMetrics.recall);
    expect(afterMetrics.mrr).toBeGreaterThan(unstemmedMetrics.mrr);

    // The residue is the thing this harness is for: it must be counted, and
    // every member of it must be classified.
    expect(residue.length).toBeGreaterThan(0);
    expect(vocabulary.length + ranking.length).toBe(residue.length);
  });

  it("recovers a note whose only mismatch was the shape of the word", () => {
    // `interviewing` against a note that says `interviewers`. Nothing here is
    // a vocabulary gap — the word is present, inflected — so this class is
    // the stemmer's, and no embedding is owed a share of it.
    const query = "notes on interviewing candidates";
    expect(unstemmed(query, K)).not.toContain("work/hiring.md");
    expect(after(query, K)).toContain("work/hiring.md");
  });

  it("recovers the plan's lexical probe, which used to answer with nothing", () => {
    const query = "how do I stop feeling burnt out at work";
    expect(before(query, K)).toEqual([]);
    expect(after(query, K)).toContain("health/burnout.md");
  });

  it("cannot recover a note that does not use the query's words, and says so", () => {
    // "tired" against a note that says "exhausted". No lexical policy reaches
    // it — this is the class, and the only class, an embedding index buys.
    const query = "what did I write about being tired";
    expect(before(query, K)).not.toContain("health/burnout.md");
    expect(after(query, K)).not.toContain("health/burnout.md");
    expect(reachable(query).has("health/burnout.md")).toBe(false);
    expect(misses(after).find((miss) => miss.query === query)?.kind).toBe("vocabulary");
  });

  it("leaves a short lookup that already had an answer byte-identical", () => {
    for (const query of ["deploy runbook", "canary release", "sourdough", "gateway migration"]) {
      expect(after(query, K), query).toEqual(before(query, K));
    }
  });

  it("answers a short lookup that had none, by relaxing it", () => {
    // `book concentration` against a note that discusses concentration and
    // never says "book": no stem reaches a word the note does not contain, so
    // the conjunction finds nothing and the relaxed plan behind it is what
    // answers. That ladder still earns its place.
    expect(before("book concentration", K)).toEqual([]);
    expect(after("book concentration", K)).toEqual(["reading/deep-work.md"]);
  });

  it("answers a short lookup the stem alone recovers, without relaxing it", () => {
    // `bm25 ranking` against a note reading "ranked by bm25": the conjunction
    // used to find nothing, because it could not stem. Now it can, and the
    // relaxed plan behind it never runs.
    expect(before("bm25 ranking", K)).toEqual([]);
    expect(unstemmed("bm25 ranking", K)).toEqual(["projects/vault-search.md"]);
    expect(after("bm25 ranking", K)).toEqual(["projects/vault-search.md"]);
  });

  it("ranks an exact word above a note that only shares its stem — in BOTH engines", () => {
    // The tier, and the pin the set-only lockstep check could not make: the
    // engines spell it differently (bm25 sums the two matched column groups,
    // the pure index sums the two contributions) and an implementation that
    // has it on one side only orders these two notes oppositely.
    const docs = { "stem-only.md": "loop", "exact.md": "loops" };
    const ranked = ["exact.md", "stem-only.md"];
    expect(
      storeOf(docs)
        .search("loops", 2)
        .map((hit) => hit.path),
    ).toEqual(ranked);
    expect(
      pureOf(docs)
        .search("loops", 2)
        .map((hit) => hit.path),
    ).toEqual(ranked);
  });

  it("does not let an over-stemmed collision outrank the word itself", () => {
    // Porter maps `busy` and `business` to ONE stem, so the shadow alone
    // cannot tell them apart and the tier is the only thing that can.
    const docs = { "busy.md": "# Busy\n", "business.md": "# Business\n" };
    expect(
      storeOf(docs)
        .search("business", 2)
        .map((hit) => hit.path)[0],
    ).toBe("business.md");
    expect(
      pureOf(docs)
        .search("business", 2)
        .map((hit) => hit.path)[0],
    ).toBe("business.md");
  });

  it("still lets a TITLE-level collision beat a BODY-level exact match, in both", () => {
    // The residual, stated rather than left to be discovered. The tier is
    // worth one extra helping of a term's own field weight, and the field
    // gap is 10x — so `busy` in a title still outranks `business` in a body
    // even though only one of them is the word the user typed. Both engines
    // agree, which is the part that matters: this is field weighting doing
    // exactly what it is for, not the two of them drifting.
    //
    // Closing it needs a signal neither engine has — how RARE the stem is
    // across the vault — and bm25 has an idf that pushes this way already,
    // enough to flip the answer on a corpus with more than two notes in it.
    // That is a reason not to over-tune the tier, not a bug to patch here.
    const docs = { "busy.md": "# Busy\n", "body.md": "# Notes\n\nThe business of the week.\n" };
    expect(
      storeOf(docs)
        .search("business", 2)
        .map((hit) => hit.path)[0],
    ).toBe("busy.md");
    expect(
      pureOf(docs)
        .search("business", 2)
        .map((hit) => hit.path)[0],
    ).toBe("busy.md");
  });

  it("folds diacritics the same way on both sides of the seam", () => {
    // FTS5's unicode61 strips diacritics itself, so the pure tokenizer has to
    // as well or `acciones` reaches one engine and not the other. This is the
    // divergence the stem shadow made reachable: the stem is computed in JS
    // and folded by SQLite.
    const docs = { "es.md": "# Acción\n\nUna acción pendiente.\n" };
    const store = storeOf(docs);
    const index = pureOf(docs);
    for (const query of ["acción", "accion", "acciones"]) {
      expect(
        store.search(query, 5).map((hit) => hit.path),
        query,
      ).toEqual(["es.md"]);
      expect(
        index.search(query, 5).map((hit) => hit.path),
        query,
      ).toEqual(["es.md"]);
    }
  });

  it("shows a stemmed hit at the word that actually matched", () => {
    // FTS5's snippet() cuts one column from THAT column's offsets, so a hit in
    // the stem shadow used to render the note's opening filler instead.
    const docs = {
      "late.md": `# Late\n\n${"filler ".repeat(30)}\n\nI have been exhausted lately.\n`,
    };
    for (const engine of [storeOf(docs), pureOf(docs)]) {
      const [hit] = engine.search("exhausting", 5);
      expect(hit?.path).toBe("late.md");
      expect(hit?.snippet).toContain("exhausted");
      expect(hit?.snippet).not.toContain("filler");
    }
  });

  it("lets one posting satisfy both halves of a conjunction it spells twice", () => {
    // `policy policies` is two content terms that stem to one, so the AND is
    // satisfiable by a note holding either spelling. That is the intended
    // reading — two spellings of one word are not two requirements — and it is
    // pinned rather than left to be rediscovered.
    const docs = { "policy.md": "# Policy\n\nOur policies are written down.\n" };
    expect(
      storeOf(docs)
        .search("policy policies", 5)
        .map((hit) => hit.path),
    ).toEqual(["policy.md"]);
    expect(
      pureOf(docs)
        .search("policy policies", 5)
        .map((hit) => hit.path),
    ).toEqual(["policy.md"]);
  });

  it("keeps the two engines in lockstep over the whole corpus", () => {
    // The policy is shared, so the hit SETS must be too — the orderings differ
    // by design (bm25 against the pure index's tiered weights).
    for (const { query } of EVAL_QUERIES) {
      const fts = new Set(after(query, REACHABLE));
      const inMemory = new Set(pure.search(query, REACHABLE).map((hit) => hit.path));
      expect([...inMemory].toSorted(), query).toEqual([...fts].toSorted());
    }
  });

  it("keeps the rank-only read identical to the full search it shadows", () => {
    // `searchRanked` exists so the related-notes probe skips excerpt work; the
    // saving is only safe while both statements interpolate one BM25_RANK and
    // one plan ladder. This is the pin that catches the day someone edits one.
    for (const { query } of EVAL_QUERIES) {
      const full = store
        .search(query, REACHABLE)
        .map((hit) => ({ path: hit.path, score: hit.score }));
      expect(store.searchRanked(query, REACHABLE), query).toEqual(full);
    }
  });
});
