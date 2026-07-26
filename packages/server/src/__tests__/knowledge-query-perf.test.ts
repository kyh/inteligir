// ---------------------------------------------------------------------------
// Query-path cost shape — the always-on tests here assert DETERMINISTIC
// properties (equivalence to a from-scratch build, how many docs get
// re-resolved, what the agent-facing search's query plan is allowed to touch),
// never wall-clock. A millisecond ceiling inside a parallel gate goes red for a
// GC pause; the numbers live in the opt-in benchmark at the bottom, which is
// what produced the table below (this repo's perf convention — see
// knowledge-hydration.test.ts and knowledge-perf-oracle.test.ts).
//
// These live in @repo/server rather than beside LinkGraphIndex because the
// second half needs the node:sqlite store to exercise FTS5.
//
// MacBook / Node 24, the shared synthetic corpus (knowledge-corpus.ts) at 50k
// docs — 400k links, 55k graph nodes. Absolute values move ±30% with machine
// load; the ratios do not.
//
//                                              scoped   whole-corpus
//   re-resolve, 1 doc edited                   0.1 ms         545 ms
//   re-resolve, 256 docs edited                5.6 ms         545 ms
//   re-resolve, 257 docs edited (over the cap)   —            806 ms
//   graph() assembly, resolution warm            —      350 / 519 ms
//   graph() cold, first call after boot          —      900 / 900 ms
//
//   search, term in one doc                    1.1 ms
//   search, term in every doc                   79 ms
//   ...term in one doc, { excludePrivate }     1.1 ms        1055 ms
//   ...term in every doc, { excludePrivate }    79 ms      198535 ms
//
// The two costs that moved are the two that RECUR. Whole-corpus re-resolution
// ran on the first backlinks/links/related/graph query after any edit, because
// one changed doc dropped the whole vault's resolution. `excludePrivate` is
// every agent query, and joining `files` for it is QUADRATIC in corpus size —
// 1.1s at 4k docs, 198s at 50k.
//
// What did NOT move, deliberately: graph()'s first call is a whole-corpus
// projection and stays one (the pair above is per-source vs vault-wide edge
// dedupe — same answer, ~30% apart). It is also not the graph view's
// bottleneck at this size: the payload is 42MB of JSON, ~90ms to stringify and
// ~125ms to parse, before d3-force ever sees 400k edges. Bounding what the
// graph view ASKS for is a renderer decision, not an index one.
//
// Set KNOWLEDGE_BENCH_DOCS=50000 to reproduce (default 10k).
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { isDocPath } from "@repo/notes/knowledge/doc-file";
import {
  LinkGraphIndex,
  type GraphEdge,
  type GraphNode,
  type LinkGraph,
} from "@repo/notes/knowledge/link-graph-index";
import type { DocProjection, StoredLink } from "@repo/notes/knowledge/projection";
import { relatedNotes } from "@repo/notes/knowledge/related-notes";
import { createSqlKnowledgeStore, type SqlDriver } from "@repo/notes/knowledge/sql-knowledge-store";
import { extnamePath } from "@repo/notes/knowledge/vault-path";

import { createSqliteKnowledgeStore } from "../knowledge/sqlite-knowledge-store";
import { docPath, memorySqlDriver, seedStore, syntheticProjection } from "./knowledge-corpus";

const BENCH_DOCS = Number(process.env["KNOWLEDGE_BENCH_DOCS"] ?? 10_000);

function seedIndex(docs: number): LinkGraphIndex {
  const index = new LinkGraphIndex();
  for (let i = 0; i < docs; i++) index.applyDoc(docPath(i), syntheticProjection(i, docs));
  return index;
}

// ---- Incremental resolution ------------------------------------------------------

/** Every query that reads the resolved state, over every path — the surface an
 * incremental re-resolve has to reproduce byte for byte. */
function resolvedSurface(index: LinkGraphIndex, paths: readonly string[]): unknown {
  return {
    backlinks: paths.map((p) => index.backlinks(p)),
    backlinksPublic: paths.map((p) => index.backlinks(p, { excludePrivate: true })),
    forward: paths.map((p) => index.forwardLinks(p)),
    graph: index.graph(),
    wikiTargets: index.wikiTargets(),
  };
}

/** The oracle: the same corpus applied to a virgin index, which has no
 * incremental state to be wrong about. */
function rebuilt(
  applied: ReadonlyArray<[string, DocProjection]>,
  others: readonly string[],
): LinkGraphIndex {
  const index = new LinkGraphIndex();
  for (const [p, proj] of applied) index.applyDoc(p, proj);
  for (const p of others) index.setOther(p);
  return index;
}

/** Wrap a links array so the test can see WHICH docs got re-resolved:
 * resolution is the only thing that calls `.map` on it. */
function countingLinks(links: StoredLink[], onResolve: () => void): StoredLink[] {
  return new Proxy(links, {
    get(target, prop): unknown {
      if (prop === "map") onResolve();
      return Reflect.get(target, prop);
    },
  });
}

function withCountedLinks(base: DocProjection, onResolve: () => void): DocProjection {
  return { ...base, links: countingLinks(base.links, onResolve) };
}

/** A `docs`-doc index whose every doc counts its own re-resolutions, already
 * folded once so the counts start from a fully resolved state. `applyCounted`
 * re-projects a doc keeping it counted. */
function seedCounted(docs: number): {
  index: LinkGraphIndex;
  resolves: Map<string, number>;
  applyCounted: (i: number, proj: DocProjection) => void;
} {
  const resolves = new Map<string, number>();
  const index = new LinkGraphIndex();
  const applyCounted = (i: number, proj: DocProjection): void => {
    const p = docPath(i);
    index.applyDoc(
      p,
      withCountedLinks(proj, () => {
        resolves.set(p, (resolves.get(p) ?? 0) + 1);
      }),
    );
  };
  for (let i = 0; i < docs; i++) applyCounted(i, syntheticProjection(i, docs));
  index.backlinks(docPath(0)); // the one whole-corpus fold
  return { index, resolves, applyCounted };
}

describe("incremental link resolution", () => {
  it("re-projecting a doc re-resolves that doc's links and nothing else", () => {
    const { index, resolves, applyCounted } = seedCounted(20);
    expect([...resolves.values()]).toEqual(Array.from({ length: 20 }, () => 1));

    // A body edit — same path, same aliases.
    resolves.clear();
    applyCounted(3, syntheticProjection(3, 20, 1));
    index.backlinks(docPath(0));
    expect([...resolves.entries()]).toEqual([[docPath(3), 1]]);

    // Repeat queries re-resolve nothing at all.
    resolves.clear();
    index.backlinks(docPath(0));
    index.forwardLinks(docPath(3));
    index.graph();
    expect([...resolves.entries()]).toEqual([]);
  });

  it("a changed alias re-resolves the whole corpus — it can re-point any link", () => {
    const { index, resolves, applyCounted } = seedCounted(20);

    resolves.clear();
    applyCounted(3, { ...syntheticProjection(3, 20, 1), aliases: ["something else"] });
    index.backlinks(docPath(0));
    expect(resolves.size).toBe(20);

    // …as does a new path appearing, for the same reason.
    resolves.clear();
    index.setOther("assets/pic.png");
    index.backlinks(docPath(0));
    expect(resolves.size).toBe(20);
  });

  it("answers exactly like a from-scratch build across a mutation sequence", () => {
    const total = 40;
    const applied = new Map<string, DocProjection>();
    const others: string[] = [];
    const index = new LinkGraphIndex();
    const apply = (i: number, revision: number, over?: Partial<DocProjection>): void => {
      const proj = { ...syntheticProjection(i, total, revision), ...over };
      applied.set(docPath(i), proj);
      index.applyDoc(docPath(i), proj);
    };
    for (let i = 0; i < total; i++) apply(i, 0);

    const check = (label: string): void => {
      const paths = [...applied.keys(), ...others, "notes/nowhere.md", "missing-000001"];
      const oracle = rebuilt([...applied.entries()], others);
      expect(resolvedSurface(index, paths), label).toEqual(resolvedSurface(oracle, paths));
    };
    check("initial");

    // Body edits — the incremental path.
    apply(5, 1);
    apply(6, 1);
    check("two body edits");
    // …interleaved with queries, so the pending set drains one doc at a time.
    apply(7, 1);
    check("edit, query, edit");
    apply(8, 1);
    check("again");

    // Alias churn, both directions.
    apply(9, 2, { aliases: ["Ninth", "IX"] });
    check("aliases added");
    apply(9, 3, { aliases: [] });
    check("aliases dropped");

    // A doc whose links now all dangle, then all resolve again.
    apply(10, 4, { links: [] });
    check("links removed");
    apply(10, 5);
    check("links restored");

    // Namespace churn around a doc that is being edited.
    index.remove(docPath(11));
    applied.delete(docPath(11));
    check("doc removed");
    apply(12, 6);
    check("edit after a removal");
    index.setOther("assets/diagram.png");
    others.push("assets/diagram.png");
    check("asset added");
    apply(13, 7);
    check("edit after an asset appeared");

    // A doc turning into an asset and back.
    index.setOther(docPath(14));
    applied.delete(docPath(14));
    others.push(docPath(14));
    check("doc became an asset");
    apply(14, 8);
    others.splice(others.indexOf(docPath(14)), 1);
    check("asset became a doc again");

    // Private flags move under excludePrivate.
    apply(15, 9, { private: true });
    check("doc turned private");
    apply(16, 9, { private: false });
    check("doc turned public");
  });

  it("stays equivalent when more docs change at once than it will splice", () => {
    // Past the incremental ceiling the fold takes over; the answer must not
    // depend on which branch ran.
    const total = 600;
    const index = seedIndex(total);
    index.backlinks(docPath(0));
    const applied = new Map<string, DocProjection>();
    for (let i = 0; i < total; i++) applied.set(docPath(i), syntheticProjection(i, total));
    for (let i = 0; i < total; i++) {
      const proj = syntheticProjection(i, total, 1);
      applied.set(docPath(i), proj);
      index.applyDoc(docPath(i), proj);
    }
    const paths = [...applied.keys()];
    expect(resolvedSurface(index, paths)).toEqual(
      resolvedSurface(rebuilt([...applied.entries()], []), paths),
    );
  });
});

// ---- graph() assembly, against a brute-force reference -----------------------------

/** The graph rebuilt from the public per-doc queries, applying the documented
 * rules (asset references excluded, phantom node per unresolved doc-shaped
 * target, parallel links collapsed with a count, degree counting EDGES). The
 * fast path collapses parallel links per SOURCE instead of vault-wide, which is
 * only equivalent because `forward` is grouped by source — this pins it. */
function oracleGraph(index: LinkGraphIndex, docs: readonly string[]): LinkGraph {
  const titles = new Map(index.wikiTargets().map((t) => [t.path, t.title]));
  const nodes = new Map<string, GraphNode>();
  for (const path of docs) {
    nodes.set(path, { id: path, title: titles.get(path) ?? "", path, phantom: false, degree: 0 });
  }
  const edgeMap = new Map<string, GraphEdge>();
  for (const source of docs) {
    for (const link of index.forwardLinks(source)) {
      if (link.kind === "image") continue;
      let targetId: string;
      if (link.targetPath !== null) {
        if (!nodes.has(link.targetPath)) continue;
        targetId = link.targetPath;
      } else {
        if (extnamePath(link.target) !== "" && !isDocPath(link.target)) continue;
        targetId = `phantom:${link.target.toLowerCase()}`;
        if (!nodes.has(targetId)) {
          nodes.set(targetId, { id: targetId, title: link.target, phantom: true, degree: 0 });
        }
      }
      const key = `${source} ${targetId} ${link.kind}`;
      const seen = edgeMap.get(key);
      if (seen) seen.count += 1;
      else edgeMap.set(key, { source, target: targetId, kind: link.kind, count: 1 });
    }
  }
  for (const edge of edgeMap.values()) {
    const source = nodes.get(edge.source);
    const target = nodes.get(edge.target);
    if (source) source.degree += 1;
    if (target && edge.target !== edge.source) target.degree += 1;
  }
  return { nodes: [...nodes.values()], edges: [...edgeMap.values()] };
}

describe("graph assembly", () => {
  it("matches the brute-force reference, including edge counts and degrees", () => {
    const total = 60;
    const index = seedIndex(total);
    const docs = Array.from({ length: total }, (_, i) => docPath(i));
    expect(index.graph()).toEqual(oracleGraph(index, docs));

    // Parallel links (same pair, same kind) and a self-link: the count/degree
    // rules the per-source collapse has to preserve.
    const twin: DocProjection = {
      ...syntheticProjection(0, total, 1),
      links: [
        { kind: "wiki", embed: false, target: "note-000001", line: 1, snippet: "a" },
        { kind: "wiki", embed: false, target: "note-000001", line: 2, snippet: "b" },
        { kind: "wiki", embed: true, target: "note-000001", line: 3, snippet: "c" },
        { kind: "md", embed: false, target: "note-000001.md", line: 4, snippet: "d" },
        { kind: "wiki", embed: false, target: "note-000000", line: 5, snippet: "self" },
        { kind: "image", embed: true, target: "pic.png", line: 6, snippet: "img" },
        { kind: "wiki", embed: false, target: "nowhere at all", line: 7, snippet: "phantom" },
        { kind: "wiki", embed: false, target: "nowhere at all", line: 8, snippet: "phantom" },
      ],
    };
    index.applyDoc(docPath(0), twin);
    expect(index.graph()).toEqual(oracleGraph(index, docs));
  });
});

// ---- The agent-facing search's query plan -------------------------------------------

/** The shared in-memory driver, remembering the SQL it was asked to run so a
 * test can EXPLAIN the store's own statements without the store exporting
 * them. `explain` reads around the recorder, so it never logs itself. */
function recordingDriver(): SqlDriver & { queries: string[]; explain: (sql: string) => string[] } {
  const base = memorySqlDriver();
  const queries: string[] = [];
  return {
    ...base,
    queries,
    all: (sql, params) => {
      queries.push(sql);
      return base.all(sql, params);
    },
    explain: (sql) =>
      base.all(`EXPLAIN QUERY PLAN ${sql}`, ["x", 10]).map((row) => String(row["detail"])),
  };
}

describe("agent-facing search", () => {
  it("filters private docs without reading the files table", () => {
    // The `files` join this replaced was quadratic in corpus size (see header):
    // SQLite re-drove the row list per matched row. The invariant that keeps it
    // linear is that the private filter is a column ON the FTS row, so the
    // query plan must not touch `files` at all.
    const driver = recordingDriver();
    try {
      const store = createSqlKnowledgeStore(driver, "/test/vault");
      seedStore(store, 20);
      driver.queries.length = 0;
      const hits = store.search("the", 10, { excludePrivate: true });
      expect(hits.length).toBeGreaterThan(0);
      expect(hits.map((h) => h.path)).not.toContain(docPath(0)); // i % 17 === 0
      const sql = driver.queries[0];
      if (sql === undefined) throw new Error("no search query recorded");
      const plan = driver.explain(sql);
      expect(plan.join(" | ")).not.toMatch(/\bfiles\b/);
    } finally {
      driver.close();
    }
  });
});

// ---- The documented benchmark ---------------------------------------------------------

function since(start: number): string {
  return `${(performance.now() - start).toFixed(1)}ms`;
}

// OPT-IN, asserting nothing about wall-clock — see the header.
describe.skipIf(process.env["KNOWLEDGE_BENCH_DOCS"] === undefined)("query benchmark", () => {
  it(`reports resolution + graph cost at ${BENCH_DOCS} docs`, () => {
    const index = seedIndex(BENCH_DOCS);

    const cold = performance.now();
    const graph = index.graph();
    const coldMs = since(cold);
    const warm0 = performance.now();
    index.graph();
    const warmMs = since(warm0);

    // The incremental path, at one doc and at the ceiling; then a batch past
    // it, which falls back to the whole-corpus fold.
    const reresolve = (docs: number, revision: number): string => {
      for (let i = 0; i < docs; i++)
        index.applyDoc(docPath(i), syntheticProjection(i, BENCH_DOCS, revision));
      const start = performance.now();
      index.backlinks(docPath(1));
      return since(start);
    };
    const oneMs = reresolve(1, 1);
    const ceilingMs = reresolve(256, 2);
    const overMs = reresolve(257, 3);

    const wire0 = performance.now();
    const wire = JSON.stringify(graph);
    const stringifyMs = since(wire0);
    const parse0 = performance.now();
    JSON.parse(wire);
    const parseMs = since(parse0);

    console.log(
      `[graph @ ${BENCH_DOCS}] nodes=${graph.nodes.length} edges=${graph.edges.length} | ` +
        `cold=${coldMs} warm=${warmMs} | ` +
        `wire=${(wire.length / 1e6).toFixed(1)}MB stringify=${stringifyMs} parse=${parseMs}`,
    );
    console.log(
      `[re-resolve @ ${BENCH_DOCS}] 1 doc=${oneMs} 256 docs=${ceilingMs} 257 docs=${overMs}`,
    );
    expect(graph.nodes.length).toBeGreaterThan(0);
  }, 600_000);

  it(`reports search cost at ${BENCH_DOCS} docs`, () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "knowledge-query-perf-"));
    const store = createSqliteKnowledgeStore(path.join(tmp, "bench.sqlite"), "/test/vault");
    try {
      seedStore(store, BENCH_DOCS);
      for (const [label, query] of [
        ["term in one doc", "body-000042"],
        ["term in every doc", "the"],
        ["two common terms", "quick brown"],
        ["prefix only", "fil"],
      ] satisfies Array<[string, string]>) {
        store.search(query, 25); // warm the page cache
        const plain = performance.now();
        store.search(query, 25);
        const plainMs = since(plain);
        const priv = performance.now();
        store.search(query, 25, { excludePrivate: true });
        console.log(`[search @ ${BENCH_DOCS}] ${label}: ${plainMs} | private ${since(priv)}`);
      }
      const index = seedIndex(BENCH_DOCS);
      index.backlinks(docPath(1)); // warm resolution
      const related = performance.now();
      relatedNotes(index, (q, l) => store.search(q, l), docPath(1));
      console.log(`[related @ ${BENCH_DOCS}] ${since(related)}`);
      expect(store.search("body-000042", 25)).toHaveLength(1);
    } finally {
      store.dispose();
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }, 600_000);
});
