// pnpm --filter inteligir exec vitest run src/server/knowledge/__tests__/search-eval
// scores the labelled corpus under three policies over the real store, then
// classifies each surviving miss: ranking (reachable at some rank) or
// vocabulary (no lexical query reaches it — the case only an embedding buys).

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
import { afterAll, beforeAll, describe, expect, it, onTestFinished } from "vitest";
import { makeTempDir } from "../../__tests__/temp-dir";
import { createSqliteDriver } from "../sqlite-driver";
import { EVAL_QUERIES, EVAL_VAULT, type EvalQuery } from "./search-eval-vault";
import { z } from "zod";

const K = 10;
// wider than the corpus, so "found" means reachable at all.
const REACHABLE = 200;

type Retrieve = (query: string, limit: number) => string[];

// frozen baseline: must not track what the store does now, so the tokenizer is inlined too.
function legacyMatchExpression(query: string): string | null {
  const tokens = [...new Set(query.toLowerCase().match(/[\p{L}\p{N}_]+/gu) ?? [])];
  if (tokens.length === 0) return null;
  return tokens
    .map((token, i) => (i === tokens.length - 1 ? `"${token}" *` : `"${token}"`))
    .join(" ");
}

function unstemmedMatchExpression(plan: SearchQueryPlan): string {
  return plan.terms
    .map((term) => `{title headings body}: "${term.token}"${term.prefix ? " *" : ""}`)
    .join(plan.match === "all" ? " AND " : " OR ");
}

// same bm25 field weights as the store, so the columns are comparable.
const PROBE_SEARCH_SQL = `
SELECT path, bm25(search_fts, 10.0, 4.0, 1.0, 10.0, 4.0, 1.0) AS rank
FROM search_fts WHERE search_fts MATCH ?
ORDER BY rank, path LIMIT ?
`;

type Metrics = {
  // at least one correct note in the top K.
  answered: number;
  recall: number;
  precisionAt1: number;
  // ceiling is mean gold-set size / K (~0.11), so read as a noise gauge.
  precisionAtK: number;
  mrr: number;
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

// not Object.keys: it answers string, not keyof Metrics.
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

let driver: SqlDriver;
let store: SqlKnowledgeStore;
let pure: KnowledgeIndex;

beforeAll(() => {
  driver = createSqliteDriver(
    join(makeTempDir("inteligir-search-eval-", { lifetime: "suite" }), "knowledge.db"),
  );
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

const unstemmed: Retrieve = (query, limit) => {
  for (const plan of planSearchQuery(query)) {
    const rows = probe(unstemmedMatchExpression(plan), limit);
    if (rows.length > 0) return rows;
  }
  return [];
};

const after: Retrieve = (query, limit) => store.search(query, limit).map((hit) => hit.path);

// a store per test: a note added for one relation would change another's ranking.
function storeOf(docs: Readonly<Record<string, string>>): SqlKnowledgeStore {
  const built = createSqlKnowledgeStore(
    createSqliteDriver(join(makeTempDir("inteligir-search-tier-"), "knowledge.db")),
    "/vault",
  );
  onTestFinished(() => built.dispose());
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

function pureOf(docs: Readonly<Record<string, string>>): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(docs)) index.setDoc(path, content);
  return index;
}

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

    expect(unstemmedMetrics.answered).toBeGreaterThan(beforeMetrics.answered);
    expect(unstemmedMetrics.recall).toBeGreaterThan(beforeMetrics.recall);
    expect(unstemmedMetrics.mrr).toBeGreaterThan(beforeMetrics.mrr);
    expect(afterMetrics.meanResults).toBeLessThan(Object.keys(EVAL_VAULT).length / 2);

    expect(afterMetrics.recall).toBeGreaterThan(unstemmedMetrics.recall);
    expect(afterMetrics.mrr).toBeGreaterThan(unstemmedMetrics.mrr);

    expect(residue.length).toBeGreaterThan(0);
    expect(vocabulary.length + ranking.length).toBe(residue.length);
  });

  it("recovers a note whose only mismatch was the shape of the word", () => {
    const query = "notes on interviewing candidates";
    expect(unstemmed(query, K)).not.toContain("work/hiring.md");
    expect(after(query, K)).toContain("work/hiring.md");
  });

  it("recovers the plan's lexical probe where the unstemmed plan answers nothing", () => {
    const query = "how do I stop feeling burnt out at work";
    expect(before(query, K)).toEqual([]);
    expect(after(query, K)).toContain("health/burnout.md");
  });

  it("cannot recover a note that does not use the query's words, and says so", () => {
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
    expect(before("book concentration", K)).toEqual([]);
    expect(after("book concentration", K)).toEqual(["reading/deep-work.md"]);
  });

  it("answers a short lookup the stem alone recovers, without relaxing it", () => {
    expect(before("bm25 ranking", K)).toEqual([]);
    expect(unstemmed("bm25 ranking", K)).toEqual(["projects/vault-search.md"]);
    expect(after("bm25 ranking", K)).toEqual(["projects/vault-search.md"]);
  });

  it("ranks an exact word above a note that only shares its stem — in BOTH engines", () => {
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
    // porter stems busy and business to one stem.
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
    // the title/body field gap is 10x; only idf could close this, and only bm25 has one.
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
    // FTS5's unicode61 strips diacritics itself, so the pure tokenizer must too.
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
    // FTS5's snippet() cuts from the matched column's own offsets, so a stem-column hit would render the opening filler.
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
    // policy and policies stem to one term, so either spelling satisfies the AND.
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
    // sets, not orderings: bm25 and the pure index's tiered weights rank differently.
    for (const { query } of EVAL_QUERIES) {
      const fts = new Set(after(query, REACHABLE));
      const inMemory = new Set(pure.search(query, REACHABLE).map((hit) => hit.path));
      expect([...inMemory].toSorted(), query).toEqual([...fts].toSorted());
    }
  });

  it("keeps the rank-only read identical to the full search it shadows", () => {
    for (const { query } of EVAL_QUERIES) {
      const full = store
        .search(query, REACHABLE)
        .map((hit) => ({ path: hit.path, score: hit.score }));
      expect(store.searchRanked(query, REACHABLE), query).toEqual(full);
    }
  });
});
