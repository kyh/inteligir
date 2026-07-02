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
});

describe("KnowledgeIndex — forward links", () => {
  it("reports resolved and dangling targets distinctly", () => {
    const forward = seeded().forwardLinks("wiki/hub.md");
    const byTarget = new Map(forward.map((f) => [f.target, f]));
    expect(byTarget.get("target note")?.targetPath).toBe("wiki/target note.md");
    expect(byTarget.get("missing note")?.targetPath).toBeNull();
    expect(byTarget.get("diagram.png")).toMatchObject({
      targetPath: "diagram.png",
      embed: true,
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
    expect(ids).toContain("diagram.png");
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
    // hub edges: ->target, ->phantom, ->diagram, ->other, <-other = 5 touching.
    expect(hub?.degree).toBe(5);
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
  it("lists docs (not assets) with titles, sorted by path", () => {
    expect(seeded().wikiTargets()).toEqual([
      { path: "notes/other.md", title: "Other" },
      { path: "wiki/hub.md", title: "Hub" },
      { path: "wiki/target note.md", title: "Target note" },
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
    expect(index.wikiTargets()).toEqual([{ path: "plain notes.md", title: "plain notes" }]);
  });
});
