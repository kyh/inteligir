import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { renameCandidates } from "@repo/notes/knowledge/rename-candidates";

const indexOf = (docs: Record<string, string>): KnowledgeIndex => {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(docs)) {
    index.setDoc(path, content);
  }
  return index;
};

describe("renameCandidates", () => {
  it("names the moved doc and its backlink sources", () => {
    const index = indexOf({
      "a.md": "Links to [[target]].\n",
      "b.md": "See [details](notes/target.md).\n",
      "notes/target.md": "# Target\n",
      "unrelated.md": "No links, though target is a word.\n",
    });
    const candidates = renameCandidates(index, "notes/target.md", "archive/moved.md");
    expect(candidates.toSorted()).toEqual(["a.md", "b.md", "notes/target.md"]);
  });

  it("names docs whose short links the new name would shadow", () => {
    const index = indexOf({
      "a/note.md": "# A note\n",
      "other.md": "# Other\n",
      "s.md": "Ref [[note]] here.\n",
    });
    const candidates = renameCandidates(index, "other.md", "note.md");
    expect(candidates.toSorted()).toEqual(["other.md", "s.md"]);
  });

  it("names docs whose links resolve only via an alias the new name steals", () => {
    const index = indexOf({
      "l.md": "Ref [[Bar]] here.\n",
      "owner.md": "---\naliases:\n  - Bar\n---\n# Owner\n",
      "x.md": "# X\n",
    });
    const candidates = renameCandidates(index, "x.md", "Bar.md");
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
    const candidates = renameCandidates(index, "target.md", "moved.md");
    expect(candidates).not.toContain("clean.md");
    expect(candidates).toContain("target.md");
  });
});
