import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../knowledge/knowledge-index";

const seeded = (): KnowledgeIndex => {
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
};

describe("KnowledgeIndex — backlinks", () => {
  it("lists sources with line, snippet, and alias", () => {
    const backlinks = seeded().backlinks("wiki/target note.md");
    expect(backlinks).toHaveLength(2);
    expect(backlinks[0]).toMatchObject({
      embed: false,
      kind: "wiki",
      line: 3,
      sourcePath: "wiki/hub.md",
    });
    expect(backlinks[0]?.snippet).toContain("[[target note]]");
    expect(backlinks[1]).toMatchObject({ alias: "the target" });
  });

  it("resolves relative md links into backlinks", () => {
    const backlinks = seeded().backlinks("notes/other.md");
    expect(backlinks).toEqual([
      expect.objectContaining({ alias: "other", kind: "md", sourcePath: "wiki/hub.md" }),
    ]);
  });

  it("returns [] for unlinked docs", () => {
    // via [[hub]]
    expect(seeded().backlinks("wiki/hub.md")).toHaveLength(1);
    expect(seeded().backlinks("nowhere.md")).toEqual([]);
  });

  it("answers asset backlinks: wiki embeds AND md images", () => {
    const backlinks = seeded().backlinks("diagram.png");
    expect(backlinks).toHaveLength(2);
    expect(backlinks[0]).toMatchObject({ embed: true, kind: "wiki", sourcePath: "wiki/hub.md" });
    expect(backlinks[1]).toMatchObject({
      alias: "the diagram",
      embed: true,
      kind: "image",
      sourcePath: "wiki/hub.md",
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
      embed: true,
      kind: "wiki",
      targetPath: "diagram.png",
    });
    expect(byTarget.get("../diagram.png")).toMatchObject({
      alias: "the diagram",
      embed: true,
      kind: "image",
      targetPath: "diagram.png",
    });
    expect(byTarget.get("../notes/other.md")?.targetPath).toBe("notes/other.md");
  });
});

describe("KnowledgeIndex — case-colliding paths", () => {
  // a case-sensitive fs (linux) can hold both
  it("keeps Note.md and note.md distinct without double-counting links", () => {
    const index = new KnowledgeIndex();
    index.setDoc("Note.md", "# Big\n");
    index.setDoc("note.md", "# Small\n");
    index.setDoc("hub.md", "[[Note]] and [[note]] and [[NOTE]]\n");
    const targets = index.forwardLinks("hub.md").map((f) => f.targetPath);
    expect(targets).toEqual(["Note.md", "note.md", "Note.md"]);
    expect(index.backlinks("Note.md")).toHaveLength(2);
    expect(index.backlinks("note.md")).toHaveLength(1);
    expect(index.problems({ limit: 10 }).unresolvedLinks.rows).toEqual([]);
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
    expect(index.problems({ limit: 10 }).unresolvedLinks.rows).toEqual([]);
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
