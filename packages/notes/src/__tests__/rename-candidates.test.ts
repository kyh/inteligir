import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { moveCandidates } from "@repo/notes/knowledge/rename-candidates";

const indexOf = (docs: Record<string, string>): KnowledgeIndex => {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(docs)) {
    index.setDoc(path, content);
  }
  return index;
};

describe("moveCandidates", () => {
  it("names the moved doc and its backlink sources", () => {
    const index = indexOf({
      "a.md": "Links to [[target]].\n",
      "b.md": "See [details](notes/target.md).\n",
      "notes/target.md": "# Target\n",
      "unrelated.md": "No links, though target is a word.\n",
    });
    const candidates = moveCandidates(index, new Map([["notes/target.md", "archive/moved.md"]]));
    expect(candidates.toSorted()).toEqual(["a.md", "b.md", "notes/target.md"]);
  });

  it("names docs whose short links the new name would shadow", () => {
    const index = indexOf({
      "a/note.md": "# A note\n",
      "other.md": "# Other\n",
      "s.md": "Ref [[note]] here.\n",
    });
    const candidates = moveCandidates(index, new Map([["other.md", "note.md"]]));
    expect(candidates.toSorted()).toEqual(["other.md", "s.md"]);
  });

  it("names docs whose links resolve only via an alias the new name steals", () => {
    const index = indexOf({
      "l.md": "Ref [[Bar]] here.\n",
      "owner.md": "---\naliases:\n  - Bar\n---\n# Owner\n",
      "x.md": "# X\n",
    });
    const candidates = moveCandidates(index, new Map([["x.md", "Bar.md"]]));
    expect(candidates.toSorted()).toEqual(["l.md", "x.md"]);
  });

  it("does not name a doc whose link reaches the moved doc via its own alias", () => {
    // via-alias.md is still named: selection is a backlink superset, and
    // backlinks resolve through aliases. Only clean.md must be absent.
    const index = indexOf({
      "clean.md": "# Clean\n",
      "target.md": "---\naliases:\n  - Nickname\n---\n# Target\n",
      "via-alias.md": "Ref [[Nickname]].\n",
    });
    const candidates = moveCandidates(index, new Map([["target.md", "moved.md"]]));
    expect(candidates).not.toContain("clean.md");
    expect(candidates).toContain("target.md");
  });

  it("names every file a folder move carries, their backlinks, and the links it would steal", () => {
    const index = indexOf({
      "deep/proj/note.md": "Up to [[hub]].\n",
      "deep/proj/sub/inner.md": "# Inner\n",
      "hub.md": "See [n](deep/proj/sub/inner.md).\n",
      "loose.md": "Ref [[note]] here.\n",
      "unrelated.md": "No links.\n",
      "x/note.md": "# X note\n",
    });
    const candidates = moveCandidates(
      index,
      new Map([
        ["deep/proj/note.md", "a/note.md"],
        ["deep/proj/sub/inner.md", "a/sub/inner.md"],
      ]),
    );
    expect(candidates.toSorted()).toEqual([
      "deep/proj/note.md",
      "deep/proj/sub/inner.md",
      "hub.md",
      "loose.md",
    ]);
  });
});
