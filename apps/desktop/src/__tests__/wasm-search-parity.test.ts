// ---------------------------------------------------------------------------
// The point of the wasm driver: harness search must RANK like the product.
// Build the identical corpus (the harness's own SAMPLE_NOTES) through the
// node:sqlite store (what desktop runs) and through core's SQL store over the
// wasm driver (what the harness runs), and require identical FTS5 bm25
// result ORDER for a battery of queries. Both bindings execute the one shared
// schema + SEARCH_SQL in @repo/core/knowledge/sql-knowledge-store.ts — this
// test pins that the byte-level drivers cannot make them diverge.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import type { KnowledgeStore } from "@repo/core/knowledge/knowledge-store";
import { projectDoc } from "@repo/core/knowledge/projection";
import { createSqlKnowledgeStore } from "@repo/core/knowledge/sql-knowledge-store";
import { createSqliteKnowledgeStore } from "@repo/features/server/knowledge/sqlite-knowledge-store";

import { SAMPLE_NOTES } from "../../dev/fixture-bridge";
import { createWasmSqlDriver, loadSqlite3 } from "../../dev/wasm-sql-driver";

const ROOT = "/parity-vault";

const sqlite3 = await loadSqlite3();

/** Feed the shared harness corpus into a store, host-style (one transaction). */
function seed(store: KnowledgeStore): KnowledgeStore {
  let at = 0;
  store.transaction(() => {
    for (const [path, content] of Object.entries(SAMPLE_NOTES)) {
      at++;
      store.upsertDoc(
        {
          path,
          fingerprint: { mtimeMs: at, size: content.length, ino: at },
          contentHash: `parity-${at}`,
          projection: projectDoc(path, content),
        },
        content,
      );
    }
  });
  return store;
}

// Multi-hit queries against SAMPLE_NOTES (title-vs-body weighting, AND'd
// tokens, last-token prefix) — the shapes where a ranking fork would show.
const QUERIES = [
  "note",
  "notes",
  "target",
  "target note",
  "hub",
  "project",
  "harness",
  "toggle",
  "editor",
  "wiki",
  "meta",
  "roadm", // prefix: search-as-you-type
  "sync eng", // AND + prefix
];

describe("wasm vs node:sqlite search parity (harness ranks like desktop)", () => {
  it("returns the same bm25 ordering for the fixture corpus", () => {
    const wasmStore = seed(createSqlKnowledgeStore(createWasmSqlDriver(sqlite3), ROOT));
    const nodeStore = seed(createSqliteKnowledgeStore(":memory:", ROOT));
    try {
      let multiHitQueries = 0;
      for (const query of QUERIES) {
        const wasmHits = wasmStore.search(query, 20);
        const nodeHits = nodeStore.search(query, 20);
        // Order + identity + snippet must match exactly…
        expect(
          wasmHits.map(({ path, title, snippet }) => ({ path, title, snippet })),
          `query: ${query}`,
        ).toEqual(nodeHits.map(({ path, title, snippet }) => ({ path, title, snippet })));
        // …and scores agree to float noise (two independent SQLite builds).
        wasmHits.forEach((hit, i) => {
          expect(hit.score, `query: ${query} [${i}]`).toBeCloseTo(
            nodeHits[i]?.score ?? Number.NaN,
            10,
          );
        });
        if (wasmHits.length > 1) multiHitQueries++;
      }
      // Parity over singleton results would be vacuous — most queries must
      // produce a real ranking to compare.
      expect(multiHitQueries).toBeGreaterThanOrEqual(8);
    } finally {
      wasmStore.dispose();
      nodeStore.dispose();
    }
  });
});
