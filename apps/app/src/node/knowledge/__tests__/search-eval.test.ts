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
// It scores the labelled corpus in search-eval-vault.ts twice — under the
// AND-every-token expression this repo shipped before stage 1, and under what
// it ships now — over the REAL store, so the numbers are FTS5's and bm25's
// rather than a model of them.
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
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";
import { EVAL_QUERIES, EVAL_VAULT, type EvalQuery } from "./search-eval-vault";

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

/** The store's own ranked read, copied for the baseline only — the current
 * store builds its expression internally, so the old one cannot be run
 * through it. Same bm25 field weights, so the two columns are comparable. */
const BASELINE_SEARCH_SQL = `
SELECT path, bm25(search_fts, 10.0, 4.0, 1.0) AS rank
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
    for (const key of Object.keys(totals) as Array<keyof Metrics>) totals[key] += one[key];
  }
  for (const key of Object.keys(totals) as Array<keyof Metrics>) totals[key] /= queries.length;
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
});

const before: Retrieve = (query, limit) => {
  const match = legacyMatchExpression(query);
  if (match === null) return [];
  return driver
    .all(BASELINE_SEARCH_SQL, [match, limit])
    .map((row) => (typeof row.path === "string" ? row.path : ""));
};

const after: Retrieve = (query, limit) => store.search(query, limit).map((hit) => hit.path);

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

describe("vault search — the stage 1 measurement", () => {
  it("reports what relaxing the query bought, and what it left behind", () => {
    const beforeMetrics = measure(before, EVAL_QUERIES);
    const afterMetrics = measure(after, EVAL_QUERIES);
    const residue = misses(after);
    const vocabulary = residue.filter((miss) => miss.kind === "vocabulary");
    const ranking = residue.filter((miss) => miss.kind === "ranking");

    const lines = [
      "",
      `search eval — ${Object.keys(EVAL_VAULT).length} notes, ${EVAL_QUERIES.length} labelled queries`,
      formatMetrics("before", beforeMetrics),
      formatMetrics("after", afterMetrics),
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
    expect(afterMetrics.answered).toBeGreaterThan(beforeMetrics.answered);
    expect(afterMetrics.recall).toBeGreaterThan(beforeMetrics.recall);
    expect(afterMetrics.mrr).toBeGreaterThan(beforeMetrics.mrr);
    expect(afterMetrics.meanResults).toBeLessThan(Object.keys(EVAL_VAULT).length / 2);

    // The residue is the thing this harness is for: it must be counted, and
    // every member of it must be classified.
    expect(residue.length).toBeGreaterThan(0);
    expect(vocabulary.length + ranking.length).toBe(residue.length);
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
    // `bm25 ranking` against a note reading "ranked by bm25": the conjunction
    // cannot stem, so it found nothing at all. This is the class the relaxed
    // second plan recovers, and it needs no model.
    expect(before("bm25 ranking", K)).toEqual([]);
    expect(after("bm25 ranking", K)).toEqual(["projects/vault-search.md"]);
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
});
