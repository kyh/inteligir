// ---------------------------------------------------------------------------
// Projection parity pin: feeding LinkGraphIndex through
// projectDoc() must answer every link/graph/tag query EXACTLY like the
// content-driven KnowledgeIndex — across incremental mutations. This is what
// licenses the host to hydrate LinkGraphIndex from persisted projections.
// ---------------------------------------------------------------------------

import { describe, expect, it } from "vitest";

import { KnowledgeIndex } from "../knowledge/knowledge-index";
import { LinkGraphIndex } from "../knowledge/link-graph-index";
import { projectDoc } from "../knowledge/projection";

const CORPUS: Record<string, string> = {
  "wiki/hub.md": [
    "# Hub",
    "",
    "Links: [[target note]], aliased [[target note|the target]], anchored [[target note#Section]], and a missing [[missing note]].",
    "",
    "Embed: ![[diagram.png]]",
    "",
    "Md link to [other](../notes/other.md).",
    "",
    "Image: ![the diagram](../diagram.png)",
    "",
  ].join("\n"),
  "wiki/target note.md": "# Target note\n\n## Section\n\nBody text with #meta tag.\n",
  "notes/other.md": "---\ntags: [demo]\n---\n\n# Other\n\nBack to [[hub]] and [[Note]].\n",
  "Note.md": "# Big\n",
  "note.md": "# Small\n",
  "plain notes.md": "no heading here, just text and a [[hub]] link\n",
  "self.md": "# Self\n\n[[self]] and again [[self]]\n",
};

type Pair = { reference: KnowledgeIndex; extracted: LinkGraphIndex };

function seedPair(): Pair {
  const reference = new KnowledgeIndex();
  const extracted = new LinkGraphIndex();
  for (const [path, content] of Object.entries(CORPUS)) {
    reference.setDoc(path, content);
    extracted.applyDoc(path, projectDoc(path, content));
  }
  reference.setOther("diagram.png");
  extracted.setOther("diagram.png");
  reference.setOther("assets/paper.pdf");
  extracted.setOther("assets/paper.pdf");
  return { reference, extracted };
}

function expectParity({ reference, extracted }: Pair): void {
  const paths = [...Object.keys(CORPUS), "diagram.png", "assets/paper.pdf", "nowhere.md"];
  for (const path of paths) {
    expect(extracted.backlinks(path), `backlinks(${path})`).toEqual(reference.backlinks(path));
    expect(extracted.forwardLinks(path), `forwardLinks(${path})`).toEqual(
      reference.forwardLinks(path),
    );
  }
  expect(extracted.graph()).toEqual(reference.graph());
  expect(extracted.wikiTargets()).toEqual(reference.wikiTargets());
  expect(extracted.tags()).toEqual(reference.tags());
  for (const tag of ["meta", "demo", "META", "missing-tag"]) {
    expect(extracted.notesWithTag(tag), `notesWithTag(${tag})`).toEqual(
      reference.notesWithTag(tag),
    );
  }
}

describe("LinkGraphIndex ≡ KnowledgeIndex over projectDoc", () => {
  it("answers every query identically over the seeded corpus", () => {
    expectParity(seedPair());
  });

  it("stays in parity across incremental mutations", () => {
    const pair = seedPair();
    const apply = (path: string, content: string): void => {
      pair.reference.setDoc(path, content);
      pair.extracted.applyDoc(path, projectDoc(path, content));
    };

    // A new doc resolves a previously dangling target.
    apply("missing note.md", "# Missing note\n\nNow real, tagged #meta.\n");
    expectParity(pair);

    // Removing a target re-dangles its links.
    pair.reference.remove("wiki/target note.md");
    pair.extracted.remove("wiki/target note.md");
    expectParity(pair);

    // A doc flipping to `other` drops its links and tags.
    pair.reference.setOther("notes/other.md");
    pair.extracted.setOther("notes/other.md");
    expectParity(pair);

    // Removing an asset, then re-adding content over a former asset path.
    pair.reference.remove("diagram.png");
    pair.extracted.remove("diagram.png");
    apply("notes/other.md", "# Other again\n\n[[hub]]\n");
    expectParity(pair);
  });

  it("captures per-link snippets identical to line-array lookups", () => {
    const { reference, extracted } = seedPair();
    const fromReference = reference.backlinks("wiki/target note.md").map((b) => b.snippet);
    const fromExtracted = extracted.backlinks("wiki/target note.md").map((b) => b.snippet);
    expect(fromExtracted).toEqual(fromReference);
    expect(fromExtracted[0]).toContain("[[target note]]");
  });
});

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
