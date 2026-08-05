import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../knowledge/knowledge-index";

function seeded(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  index.setDoc(
    "wiki/hub.md",
    [
      "# Hub",
      "",
      "Links: [[target note]], aliased [[target note|the target]], and a missing [[missing note]].",
      "",
      "Embed: ![[diagram.png]]",
      "",
      "Md link to [other](../notes/other.md).",
      "",
      "Image: ![the diagram](../diagram.png)",
      "",
    ].join("\n"),
  );
  index.setDoc("wiki/target note.md", "# Target note\n\nBody text.\n");
  index.setDoc("notes/other.md", "# Other\n\nBack to [[hub]].\n");
  index.setOther("diagram.png");
  return index;
}

describe("KnowledgeIndex — backlinks", () => {
  it("lists sources with line, snippet, and alias", () => {
    const backlinks = seeded().backlinks("wiki/target note.md");
    expect(backlinks).toHaveLength(2);
    expect(backlinks[0]).toMatchObject({
      sourcePath: "wiki/hub.md",
      line: 3,
      kind: "wiki",
      embed: false,
    });
    expect(backlinks[0]?.snippet).toContain("[[target note]]");
    expect(backlinks[1]).toMatchObject({ alias: "the target" });
  });

  it("resolves relative md links into backlinks", () => {
    const backlinks = seeded().backlinks("notes/other.md");
    expect(backlinks).toEqual([
      expect.objectContaining({ sourcePath: "wiki/hub.md", kind: "md", alias: "other" }),
    ]);
  });

  it("returns [] for unlinked docs", () => {
    expect(seeded().backlinks("wiki/hub.md")).toHaveLength(1); // via [[hub]]
    expect(seeded().backlinks("nowhere.md")).toEqual([]);
  });

  it("answers asset backlinks: wiki embeds AND md images", () => {
    const backlinks = seeded().backlinks("diagram.png");
    expect(backlinks).toHaveLength(2);
    expect(backlinks[0]).toMatchObject({ sourcePath: "wiki/hub.md", kind: "wiki", embed: true });
    expect(backlinks[1]).toMatchObject({
      sourcePath: "wiki/hub.md",
      kind: "image",
      embed: true,
      alias: "the diagram",
    });
  });
});

describe("KnowledgeIndex — forward links", () => {
  it("reports resolved and dangling targets distinctly", () => {
    const forward = seeded().forwardLinks("wiki/hub.md");
    const byTarget = new Map(forward.map((f) => [f.target, f]));
    expect(byTarget.get("target note")?.targetPath).toBe("wiki/target note.md");
    expect(byTarget.get("missing note")?.targetPath).toBeNull();
    expect(byTarget.get("diagram.png")).toMatchObject({
      targetPath: "diagram.png",
      kind: "wiki",
      embed: true,
    });
    expect(byTarget.get("../diagram.png")).toMatchObject({
      targetPath: "diagram.png",
      kind: "image",
      embed: true,
      alias: "the diagram",
    });
    expect(byTarget.get("../notes/other.md")?.targetPath).toBe("notes/other.md");
  });
});

describe("KnowledgeIndex — graph", () => {
  it("emits doc nodes, flagged phantom nodes, and typed deduped edges", () => {
    const graph = seeded().graph();
    const ids = graph.nodes.map((n) => n.id);
    expect(ids).toContain("wiki/hub.md");
    expect(ids).toContain("wiki/target note.md");
    const phantom = graph.nodes.find((n) => n.phantom);
    expect(phantom).toMatchObject({ id: "phantom:missing note", title: "missing note" });
    expect(phantom?.path).toBeUndefined();

    // Two wiki links hub -> target collapse into one counted edge.
    const hubToTarget = graph.edges.find(
      (e) => e.source === "wiki/hub.md" && e.target === "wiki/target note.md",
    );
    expect(hubToTarget).toMatchObject({ kind: "wiki", count: 2 });
    const mdEdge = graph.edges.find(
      (e) => e.source === "wiki/hub.md" && e.target === "notes/other.md",
    );
    expect(mdEdge?.kind).toBe("md");

    const hub = graph.nodes.find((n) => n.id === "wiki/hub.md");
    // hub edges: ->target, ->phantom, ->other, <-other = 4 touching (asset
    // references stay off the graph).
    expect(hub?.degree).toBe(4);
  });

  it("keeps the graph a notes graph: no asset nodes, edges, or phantoms", () => {
    const index = seeded();
    index.setDoc("gallery.md", "![](../diagram.png) and ![gone](missing.png) and [[lost.pdf]]\n");
    const graph = index.graph();
    const ids = graph.nodes.map((n) => n.id);
    // Resolved asset target: excluded even for the wiki embed in hub.md.
    expect(ids).not.toContain("diagram.png");
    // Dangling asset-extension targets never become phantom "create" nodes.
    expect(ids.filter((id) => id.startsWith("phantom:"))).toEqual(["phantom:missing note"]);
    expect(graph.edges.some((e) => e.source === "gallery.md")).toBe(false);
  });

  it("collapses a self-link into one edge counted once in the degree", () => {
    const index = new KnowledgeIndex();
    index.setDoc("self.md", "# Self\n\n[[self]] and again [[self]]\n");
    const graph = index.graph();
    expect(graph.edges).toEqual([{ source: "self.md", target: "self.md", kind: "wiki", count: 2 }]);
    expect(graph.nodes.find((n) => n.id === "self.md")?.degree).toBe(1);
  });

  it("folds differently-cased dangling targets into one phantom node", () => {
    const index = new KnowledgeIndex();
    index.setDoc("a.md", "[[Ghost]]\n");
    index.setDoc("b.md", "[[ghost]]\n");
    const phantoms = index.graph().nodes.filter((n) => n.phantom);
    expect(phantoms).toEqual([{ id: "phantom:ghost", title: "Ghost", phantom: true, degree: 2 }]);
  });
});

describe("KnowledgeIndex — case-colliding paths", () => {
  // Engine-level: a case-insensitive fs can't produce both, but a
  // case-sensitive vault (linux) can — no double counting, cs beats ci.
  it("keeps Note.md and note.md distinct without double-counting links", () => {
    const index = new KnowledgeIndex();
    index.setDoc("Note.md", "# Big\n");
    index.setDoc("note.md", "# Small\n");
    index.setDoc("hub.md", "[[Note]] and [[note]] and [[NOTE]]\n");
    const targets = index.forwardLinks("hub.md").map((f) => f.targetPath);
    expect(targets).toEqual(["Note.md", "note.md", "Note.md"]);
    expect(index.backlinks("Note.md")).toHaveLength(2);
    expect(index.backlinks("note.md")).toHaveLength(1);
    expect(index.graph().nodes.filter((n) => n.phantom)).toHaveLength(0);
  });
});

describe("KnowledgeIndex — incremental updates", () => {
  it("re-resolves dangling links when the missing note appears", () => {
    const index = seeded();
    expect(index.backlinks("missing note.md")).toEqual([]);
    index.setDoc("missing note.md", "# Missing note\n");
    expect(index.backlinks("missing note.md")).toEqual([
      expect.objectContaining({ sourcePath: "wiki/hub.md" }),
    ]);
    expect(index.graph().nodes.some((n) => n.phantom)).toBe(false);
  });

  it("turns links dangling when their target is removed", () => {
    const index = seeded();
    index.remove("wiki/target note.md");
    const forward = index.forwardLinks("wiki/hub.md");
    expect(forward.find((f) => f.target === "target note")?.targetPath).toBeNull();
  });

  it("drops a removed doc's own links", () => {
    const index = seeded();
    index.remove("wiki/hub.md");
    expect(index.backlinks("wiki/target note.md")).toEqual([]);
    expect(index.forwardLinks("wiki/hub.md")).toEqual([]);
  });
});

describe("KnowledgeIndex — wiki targets and search", () => {
  it("lists docs first, then attachments, each sorted by path and type-flagged", () => {
    expect(seeded().wikiTargets()).toEqual([
      { path: "notes/other.md", title: "Other", type: "doc" },
      { path: "wiki/hub.md", title: "Hub", type: "doc" },
      { path: "wiki/target note.md", title: "Target note", type: "doc" },
      { path: "diagram.png", title: "diagram.png", type: "asset" },
    ]);
  });

  it("decorates search hits with title and a matching-line snippet", () => {
    const results = seeded().search("body");
    expect(results[0]).toMatchObject({ path: "wiki/target note.md", title: "Target note" });
    expect(results[0]?.snippet).toBe("Body text.");
    expect(results[0]?.score).toBeGreaterThan(0);
  });

  it("falls back to the filename title for headingless docs", () => {
    const index = new KnowledgeIndex();
    index.setDoc("plain notes.md", "just text\n");
    expect(index.wikiTargets()).toEqual([
      { path: "plain notes.md", title: "plain notes", type: "doc" },
    ]);
  });
});

// Privacy prefilter — the excludePrivate opt every agent-facing surface layers
// its live re-probe on top of. Renderer calls (no opts) must keep seeing
// private notes: they are the user's own screen.
function privateSeeded(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  index.setDoc(
    "secret-plans.md",
    "---\nprivate: true\ntags: [meta]\n---\n# Secret plans\n\nBody about rockets.\n",
  );
  index.setDoc("public.md", "# Public\n\nBody about rockets too. #meta\n\n[[secret-plans]]\n");
  index.setDoc("broken.md", "---\n[not: valid: yaml\n---\nBody about rockets three.\n");
  return index;
}

describe("KnowledgeIndex — privacy (excludePrivate)", () => {
  it("search drops private AND unreadable-frontmatter docs entirely", () => {
    const index = privateSeeded();
    expect(
      index
        .search("rockets")
        .map((h) => h.path)
        .toSorted(),
    ).toEqual(["broken.md", "public.md", "secret-plans.md"]);
    expect(index.search("rockets", 20, { excludePrivate: true }).map((h) => h.path)).toEqual([
      "public.md",
    ]);
  });

  it("backlinks with a private target return [] (silent, not a refusal)", () => {
    const index = privateSeeded();
    expect(index.backlinks("secret-plans.md")).toHaveLength(1);
    expect(index.backlinks("secret-plans.md", { excludePrivate: true })).toEqual([]);
  });

  it("backlinks from a private source are dropped", () => {
    const index = privateSeeded();
    index.setDoc("linker.md", "---\nprivate: true\n---\n[[public]]\n");
    expect(index.backlinks("public.md").map((b) => b.sourcePath)).toEqual(["linker.md"]);
    expect(index.backlinks("public.md", { excludePrivate: true })).toEqual([]);
  });

  it("notesWithTag filters private notes", () => {
    const index = privateSeeded();
    expect(index.notesWithTag("meta")).toEqual(["public.md", "secret-plans.md"]);
    expect(index.notesWithTag("meta", { excludePrivate: true })).toEqual(["public.md"]);
  });
});

// The whole-vault reads — tasks, tags, wiki targets, graph. Unlike backlinks
// and search these take no subject path, so an ungated call is a full dump of
// the vault, and `tasks` dumps verbatim source lines with it.
function wholeVaultSeeded(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  index.setDoc(
    "secret-plans.md",
    [
      "---",
      "private: true",
      "tags: [meta, covert]",
      "---",
      "# Secret plans",
      "",
      "- [ ] Book the Reykjavik room",
      "",
      "See [[public]] and [[unwritten codename]].",
      "",
    ].join("\n"),
  );
  index.setDoc("public.md", "# Public\n\nOrdinary text. #meta\n\n- [ ] Buy milk\n");
  index.setDoc("broken.md", "---\n[not: valid: yaml\n---\n\n- [ ] Unreadable frontmatter task\n");
  return index;
}

describe("KnowledgeIndex — privacy on the whole-vault reads", () => {
  it("tasks omit private (and unreadable-frontmatter) docs, source line included", () => {
    const index = wholeVaultSeeded();
    expect(index.tasks().map((task) => task.path)).toEqual([
      "broken.md",
      "public.md",
      "secret-plans.md",
    ]);

    const filtered = index.tasks({ excludePrivate: true });
    expect(filtered.map((task) => task.path)).toEqual(["public.md"]);
    // The row carries `raw`, so the assertion is on the BYTES, not the path.
    expect(JSON.stringify(filtered)).not.toContain("Reykjavik");
    expect(JSON.stringify(filtered)).not.toContain("Unreadable");
  });

  it("tags drop private-only names and RECOMPUTE the shared counts", () => {
    const index = wholeVaultSeeded();
    expect(index.tags()).toEqual([
      { tag: "meta", count: 2 },
      { tag: "covert", count: 1 },
    ]);
    expect(index.tags({ excludePrivate: true })).toEqual([{ tag: "meta", count: 1 }]);
  });

  it("a shared tag renders in a PUBLIC note's case under excludePrivate", () => {
    const index = new KnowledgeIndex();
    index.setDoc("secret.md", "---\nprivate: true\ntags: [Reykjavik]\n---\n# Secret\n");
    index.setDoc("open.md", "# Open\n\nText. #reykjavik\n");
    expect(index.tags()).toEqual([{ tag: "Reykjavik", count: 2 }]);
    expect(index.tags({ excludePrivate: true })).toEqual([{ tag: "reykjavik", count: 1 }]);
  });

  it("wiki targets omit private docs entirely", () => {
    const index = wholeVaultSeeded();
    index.setOther("diagram.png");
    expect(index.wikiTargets().map((target) => target.path)).toEqual([
      "broken.md",
      "public.md",
      "secret-plans.md",
      "diagram.png",
    ]);
    expect(index.wikiTargets({ excludePrivate: true }).map((target) => target.path)).toEqual([
      "public.md",
      "diagram.png",
    ]);
  });

  it("the graph drops private nodes, their edges, and their phantom targets", () => {
    const index = wholeVaultSeeded();
    const full = index.graph();
    expect(full.nodes.map((node) => node.id).toSorted()).toEqual([
      "broken.md",
      "phantom:unwritten codename",
      "public.md",
      "secret-plans.md",
    ]);
    expect(full.edges).toHaveLength(2);

    const filtered = index.graph({ excludePrivate: true });
    expect(filtered.nodes).toEqual([
      { id: "public.md", title: "Public", path: "public.md", phantom: false, degree: 0 },
    ]);
    expect(filtered.edges).toEqual([]);
    // The phantom node's id IS the private note's raw link text.
    expect(JSON.stringify(filtered)).not.toContain("unwritten codename");
  });

  it("the graph drops an inbound edge from a public note to a private one", () => {
    const index = new KnowledgeIndex();
    index.setDoc("secret.md", "---\nprivate: true\n---\n# Secret\n");
    index.setDoc("open.md", "# Open\n\nSee [[secret]].\n");
    expect(index.graph().edges).toEqual([
      { source: "open.md", target: "secret.md", kind: "wiki", count: 1 },
    ]);

    const filtered = index.graph({ excludePrivate: true });
    expect(filtered.edges).toEqual([]);
    expect(filtered.nodes.map((node) => node.degree)).toEqual([0]);
  });
});
