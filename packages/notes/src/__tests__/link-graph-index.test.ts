import { describe, expect, it } from "vitest";

import { LinkGraphIndex } from "../knowledge/link-graph-index";
import { projectDoc } from "../knowledge/projection";

// Aliases ride the projection into the resolver's below-path tiers and the
// WikiTarget picker entries.
describe("LinkGraphIndex — aliases", () => {
  it("resolves [[alias]] links in forward links and backlinks", () => {
    const index = new LinkGraphIndex();
    index.applyDoc(
      "notes/retrospective.md",
      projectDoc("notes/retrospective.md", "---\naliases: [Retro]\n---\n# Retrospective\n"),
    );
    index.applyDoc("hub.md", projectDoc("hub.md", "# Hub\n\nSee [[Retro]].\n"));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("notes/retrospective.md");
    expect(index.backlinks("notes/retrospective.md").map((b) => b.sourcePath)).toEqual(["hub.md"]);
  });

  it("a real filename beats the alias; the alias updates incrementally", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("owner.md", projectDoc("owner.md", "---\naliases: [shadow]\n---\n# Owner\n"));
    index.applyDoc("hub.md", projectDoc("hub.md", "[[shadow]]\n"));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("owner.md");
    // A real file named shadow.md appears — the path tier now wins.
    index.applyDoc("shadow.md", projectDoc("shadow.md", "# Shadow\n"));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("shadow.md");
    // Alias removed from the owner — resolution follows.
    index.remove("shadow.md");
    index.applyDoc("owner.md", projectDoc("owner.md", "# Owner\n"));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBeNull();
  });

  it("wikiTargets carries aliases for docs that have them", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("a.md", projectDoc("a.md", "---\naliases: [One, Two]\n---\n# A\n"));
    index.applyDoc("b.md", projectDoc("b.md", "# B\n"));
    index.setOther("img.png");
    const targets = index.wikiTargets();
    expect(targets.find((t) => t.path === "a.md")?.aliases).toEqual(["One", "Two"]);
    expect(targets.find((t) => t.path === "b.md")?.aliases).toBeUndefined();
    expect(targets.find((t) => t.path === "img.png")?.aliases).toBeUndefined();
  });
});

// Moss's resolved-link form: [[Title|uuid]] resolves through frontmatter
// `id:` FIRST, surviving a title the writer never updated; the title tiers
// stay the fallback when no doc owns the id.
describe("LinkGraphIndex — [[Title|uuid]] id tier", () => {
  const UUID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";

  it("resolves a uuid alias by frontmatter id even when the title is stale", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("renamed.md", projectDoc("renamed.md", `---\nid: ${UUID}\n---\n# Renamed\n`));
    index.applyDoc("old-title.md", projectDoc("old-title.md", "# Old Title\n"));
    index.applyDoc("hub.md", projectDoc("hub.md", `[[Old Title|${UUID}]]\n`));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("renamed.md");
    expect(index.backlinks("renamed.md").map((b) => b.sourcePath)).toEqual(["hub.md"]);
  });

  it("falls back to the title tiers when no doc owns the id", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("note.md", projectDoc("note.md", "# Note\n"));
    index.applyDoc("hub.md", projectDoc("hub.md", `[[note|${UUID}]]\n`));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("note.md");
  });

  it("a plain-text alias never consults the id tier", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("a.md", projectDoc("a.md", "---\nid: friendly\n---\n# A\n"));
    index.applyDoc("b.md", projectDoc("b.md", "[[missing|friendly]]\n"));
    expect(index.forwardLinks("b.md")[0]?.targetPath).toBeNull();
  });

  it("an id change re-points existing links (namespace invalidation)", () => {
    const index = new LinkGraphIndex();
    index.applyDoc("one.md", projectDoc("one.md", `---\nid: ${UUID}\n---\n# One\n`));
    index.applyDoc("hub.md", projectDoc("hub.md", `[[Gone|${UUID}]]\n`));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBe("one.md");
    index.applyDoc("one.md", projectDoc("one.md", "# One\n"));
    expect(index.forwardLinks("hub.md")[0]?.targetPath).toBeNull();
  });
});
