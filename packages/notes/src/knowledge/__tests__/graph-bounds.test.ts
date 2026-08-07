// ---------------------------------------------------------------------------
// boundGraph — the graph view's TRANSFER bound. Two properties carry the
// feature and are pinned here: a bounded answer is a strict SUBSET of the
// unbounded one (so nothing is invented and node identity survives a refresh),
// and it always reports the whole graph's counts (so the view can say what it
// is not showing — a silent truncation reads as "these notes are unconnected").
//
// The last block is an OPT-IN payload measurement, not a wall-clock assertion:
// set KNOWLEDGE_BENCH_DOCS (the same knob the knowledge-query-perf
// bench uses) to print the bytes at 50k notes.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import {
  boundGraph,
  LinkGraphIndex,
  type BoundedLinkGraph,
  type GraphEdge,
  type GraphNode,
  type LinkGraph,
} from "../link-graph-index";
import { projectDoc } from "../projection";

/** A graph from bare id pairs, applying graph()'s own degree rule (degree
 * counts EDGES; a self-edge counts once). `loners` are nodes with no edges. */
function graphOf(
  pairs: ReadonlyArray<readonly [string, string]>,
  loners: readonly string[] = [],
): LinkGraph {
  const nodes = new Map<string, GraphNode>();
  const node = (id: string): GraphNode => {
    const found = nodes.get(id);
    if (found !== undefined) return found;
    const created: GraphNode = { id, title: id, path: id, phantom: false, degree: 0 };
    nodes.set(id, created);
    return created;
  };
  for (const id of loners) node(id);
  const edges = pairs.map(([source, target]): GraphEdge => {
    node(source).degree += 1;
    if (target !== source) node(target).degree += 1;
    return { source, target, kind: "wiki", count: 1 };
  });
  return { nodes: [...nodes.values()], edges };
}

const idsOf = (graph: LinkGraph): string[] => graph.nodes.map((node) => node.id);
const edgeKeysOf = (graph: LinkGraph): string[] =>
  graph.edges.map((edge) => `${edge.source}->${edge.target}`);

/** The invariants every bounded answer owes its caller, whatever the bounds. */
function expectSubsetOf(bounded: BoundedLinkGraph, full: LinkGraph): void {
  expect(bounded.totalNodes).toBe(full.nodes.length);
  expect(bounded.totalEdges).toBe(full.edges.length);
  const kept = new Set(idsOf(bounded));
  for (const node of bounded.nodes) expect(full.nodes).toContainEqual(node);
  for (const edge of bounded.edges) {
    expect(full.edges).toContainEqual(edge);
    // No half-drawn edge: an endpoint the renderer can't place is a line to
    // nowhere.
    expect(kept.has(edge.source) && kept.has(edge.target)).toBe(true);
  }
}

const CHAIN: ReadonlyArray<readonly [string, string]> = [
  ["a.md", "b.md"],
  ["b.md", "c.md"],
  ["c.md", "d.md"],
  ["d.md", "e.md"],
];

/** One hub every leaf links to — the shape that makes an unbounded frontier
 * cost the whole vault. */
function starGraph(leaves: number): LinkGraph {
  const pairs = Array.from(
    { length: leaves },
    (_, i) => [`leaf-${String(i).padStart(5, "0")}.md`, "hub.md"] as const,
  );
  return graphOf(pairs);
}

describe("boundGraph", () => {
  it("returns the whole graph, and its counts, when nothing is capped", () => {
    const full = graphOf(CHAIN);
    for (const bounds of [{}, { maxNodes: 5, maxEdges: 4 }, { maxNodes: 500 }]) {
      const bounded = boundGraph(full, bounds);
      expect(idsOf(bounded)).toEqual(idsOf(full));
      expect(bounded.edges).toEqual(full.edges);
      expect(bounded.totalNodes).toBe(5);
      expect(bounded.totalEdges).toBe(4);
    }
  });

  it("expands outward from the focus, nearest first", () => {
    const full = graphOf(CHAIN);
    const bounded = boundGraph(full, { focus: "a.md", maxNodes: 3 });
    expect(idsOf(bounded).toSorted()).toEqual(["a.md", "b.md", "c.md"]);
    expect(edgeKeysOf(bounded)).toEqual(["a.md->b.md", "b.md->c.md"]);
    expectSubsetOf(bounded, full);
  });

  it("reaches the focus through INBOUND links too", () => {
    // e.md only ever appears as a target; walking forward-only would strand it.
    const full = graphOf(CHAIN);
    const bounded = boundGraph(full, { focus: "e.md", maxNodes: 2 });
    expect(idsOf(bounded).toSorted()).toEqual(["d.md", "e.md"]);
  });

  it("fills the remaining budget with the most-connected notes", () => {
    const full = graphOf(CHAIN, ["island.md"]);
    // The focus's whole component is 5 nodes; a 6th slot picks up the island.
    expect(boundGraph(full, { focus: "a.md", maxNodes: 6 }).nodes).toHaveLength(6);
    // Isolated focus: itself, then the hubs.
    const bounded = boundGraph(full, { focus: "island.md", maxNodes: 3 });
    expect(idsOf(bounded)).toContain("island.md");
    expect(bounded.nodes).toHaveLength(3);
    expectSubsetOf(bounded, full);
  });

  it("seeds by degree when no focus is given, or the focus names no node", () => {
    const full = starGraph(6);
    for (const bounds of [{ maxNodes: 3 }, { focus: "nowhere.md", maxNodes: 3 }]) {
      const bounded = boundGraph(full, bounds);
      expect(idsOf(bounded)).toContain("hub.md");
      expect(bounded.nodes).toHaveLength(3);
      expect(idsOf(bounded)).not.toContain("nowhere.md");
      expectSubsetOf(bounded, full);
    }
  });

  it("bounds the answer against a hub that touches the whole vault", () => {
    const full = starGraph(5_000);
    const bounded = boundGraph(full, { focus: "leaf-04999.md", maxNodes: 10 });
    expect(bounded.nodes).toHaveLength(10);
    expect(idsOf(bounded)).toContain("leaf-04999.md");
    expect(idsOf(bounded)).toContain("hub.md");
    expect(bounded.totalNodes).toBe(5_001);
    expectSubsetOf(bounded, full);
  });

  it("cuts the outermost edges when the induced set still exceeds maxEdges", () => {
    const full = graphOf(CHAIN);
    const bounded = boundGraph(full, { focus: "a.md", maxNodes: 5, maxEdges: 2 });
    // Every node survives; only the far end of the chain loses its links.
    expect(idsOf(bounded)).toEqual(idsOf(full));
    expect(edgeKeysOf(bounded)).toEqual(["a.md->b.md", "b.md->c.md"]);
    expectSubsetOf(bounded, full);
  });

  it("answers an empty graph, and a zero budget, without inventing anything", () => {
    const empty = boundGraph({ nodes: [], edges: [] }, { maxNodes: 10, maxEdges: 10 });
    expect(empty).toEqual({ nodes: [], edges: [], totalNodes: 0, totalEdges: 0 });
    const none = boundGraph(graphOf(CHAIN), { maxNodes: 0 });
    expect(none).toEqual({ nodes: [], edges: [], totalNodes: 5, totalEdges: 4 });
  });

  it("bounds the REAL index's graph, phantoms and all", () => {
    const index = new LinkGraphIndex();
    const corpus: Record<string, string> = {
      "notes/hub.md": "# Hub\n\n[[notes/one]] [[notes/two]] [[not written yet]]\n",
      "notes/one.md": "# One\n\n[[notes/two]]\n",
      "notes/two.md": "# Two\n",
      "notes/far.md": "# Far\n",
    };
    for (const [path, content] of Object.entries(corpus)) {
      index.applyDoc(path, projectDoc(path, content));
    }
    const full = index.graph();
    expect(full.nodes).toHaveLength(5); // 4 docs + the phantom

    const bounded = boundGraph(full, { focus: "notes/one.md", maxNodes: 3 });
    expect(idsOf(bounded).toSorted()).toEqual(["notes/hub.md", "notes/one.md", "notes/two.md"]);
    expect(bounded.totalNodes).toBe(5);
    expect(bounded.totalEdges).toBe(full.edges.length);
    expectSubsetOf(bounded, full);

    // Degree is the WHOLE graph's, so a note is drawn the same size bounded or not.
    const hub = bounded.nodes.find((node) => node.id === "notes/hub.md");
    expect(hub?.degree).toBe(full.nodes.find((node) => node.id === "notes/hub.md")?.degree);
  });
});

// ---- Payload size --------------------------------------------------------------
//
// BYTES, not milliseconds: the wire payload is deterministic for a fixed
// corpus, so this belongs in the always-on gate (the repo's no-wall-clock rule
// costs nothing here). Measured against the 50k-doc query-perf
// corpus — 55,000 nodes / 400,000 edges: 42,020,060 bytes unbounded,
// 937,138 bytes under the renderer's 2,000 / 8,000 caps.

const benchPath = (i: number): string => `notes/note-${String(i).padStart(6, "0")}.md`;

/** That corpus's SHAPE, built as a graph directly: `docs` notes, 7 resolving
 * links each, plus one dangling link per 10 notes collapsing into shared
 * phantoms. Ids are fixed-width, so per-node/per-edge bytes don't drift with
 * `docs` — only their COUNT does, which is the point below. */
function benchGraph(docs: number): LinkGraph {
  const pairs: Array<readonly [string, string]> = [];
  for (let i = 0; i < docs; i++) {
    for (let k = 1; k <= 7; k++) pairs.push([benchPath(i), benchPath((i + k * 37) % docs)]);
    pairs.push([benchPath(i), `phantom:missing-${String(i % (docs / 10)).padStart(6, "0")}`]);
  }
  return graphOf(pairs);
}

describe("graph payload", () => {
  it("is sized by the caps, not by the vault", () => {
    const bounds = { focus: benchPath(42), maxNodes: 2_000, maxEdges: 8_000 };
    const smallVault = boundGraph(benchGraph(2_500), bounds);
    const largeVault = boundGraph(benchGraph(10_000), bounds);

    // Four times the vault, the same answer size — an unbounded graph would be
    // four times the transfer.
    for (const bounded of [smallVault, largeVault]) {
      expect(bounded.nodes).toHaveLength(2_000);
      expect(bounded.edges).toHaveLength(8_000);
      expect(JSON.stringify(bounded).length).toBeLessThan(1_100_000);
    }
    expect(largeVault.totalNodes).toBe(4 * smallVault.totalNodes);

    // …against the whole-vault payload, which outgrows the view well before
    // 50k notes.
    const unbounded = JSON.stringify(boundGraph(benchGraph(10_000), {})).length;
    expect(unbounded).toBeGreaterThan(6_000_000);
  }, 30_000);
});
