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
