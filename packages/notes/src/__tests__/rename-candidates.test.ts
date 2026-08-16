import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { renameCandidates } from "@repo/notes/knowledge/rename-candidates";

function indexOf(docs: Record<string, string>): KnowledgeIndex {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(docs)) index.setDoc(path, content);
  return index;
}

describe("renameCandidates", () => {
  it("names the moved doc and its backlink sources", () => {
    const index = indexOf({
      "notes/target.md": "# Target\n",
      "a.md": "Links to [[target]].\n",
      "b.md": "See [details](notes/target.md).\n",
      "unrelated.md": "No links, though target is a word.\n",
    });
    const candidates = renameCandidates(index, "notes/target.md", "archive/moved.md");
    expect(candidates.toSorted()).toEqual(["a.md", "b.md", "notes/target.md"]);
  });

  it("names docs whose short links the new name would shadow", () => {
    const index = indexOf({
      "a/note.md": "# A note\n",
      "s.md": "Ref [[note]] here.\n",
      "other.md": "# Other\n",
    });
    const candidates = renameCandidates(index, "other.md", "note.md");
    expect(candidates.toSorted()).toEqual(["other.md", "s.md"]);
  });

  it("names docs whose links resolve only via an alias the new name steals", () => {
    const index = indexOf({
      "owner.md": "---\naliases:\n  - Bar\n---\n# Owner\n",
      "l.md": "Ref [[Bar]] here.\n",
      "x.md": "# X\n",
    });
    const candidates = renameCandidates(index, "x.md", "Bar.md");
    expect(candidates.toSorted()).toEqual(["l.md", "x.md"]);
  });

  it("does not name a doc whose link reaches the moved doc via its own alias", () => {
    // The alias travels with the file's frontmatter and still resolves after
    // the rename — the surgery must not rewrite it, but candidate selection
    // deliberately stays a superset built on backlinks, so the aliased source
    // IS named (backlinks resolve through aliases). What matters is that the
    // unrelated doc is not.
    const index = indexOf({
      "target.md": "---\naliases:\n  - Nickname\n---\n# Target\n",
      "via-alias.md": "Ref [[Nickname]].\n",
      "clean.md": "# Clean\n",
    });
    const candidates = renameCandidates(index, "target.md", "moved.md");
    expect(candidates).not.toContain("clean.md");
    expect(candidates).toContain("target.md");
  });
});
