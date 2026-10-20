import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "@repo/notes/knowledge/knowledge-index";
import { resolverEntriesOf } from "@repo/notes/knowledge/link-graph-index";
import { movesOf, renameAlias, renameWrites } from "@repo/notes/knowledge/plan-rename";
import type { RenameSource, RenameWrite } from "@repo/notes/knowledge/plan-rename";
import { moveCandidates } from "@repo/notes/knowledge/rename-candidates";
import { computeMoveEdits } from "@repo/notes/knowledge/rename-links";

// the pipeline both callers run over their own index: candidates, the edits, then the writes
const planOver = (files: Record<string, string>, source: RenameSource, to: string) => {
  const index = new KnowledgeIndex();
  for (const [path, content] of Object.entries(files)) {
    index.setDoc(path, content);
  }
  const allFiles = Object.keys(files);
  const moves = movesOf(source, allFiles, to);
  const docs = new Map(
    moveCandidates(index, moves).map((path): [string, string] => [path, files[path] ?? ""]),
  );
  const { aliasEntries, idEntries } = resolverEntriesOf(index.wikiTargets());
  const edits = computeMoveEdits({ aliasEntries, allFiles, docs, idEntries, moves });
  const alias = renameAlias(source, to);
  return { alias, writes: renameWrites({ alias, edits, moves, renamed: to }) };
};

const byPath = (writes: readonly RenameWrite[]): Record<string, string> =>
  Object.fromEntries(writes.map((write) => [write.path, write.content]));

describe("planning a rename", () => {
  it("rewrites the backlinks and owes the old stem as an alias the note's own write lacks", () => {
    const { alias, writes } = planOver(
      {
        "a.md": "Links to [[target]] today.\n",
        "b.md": "See [details](notes/target.md) for more.\n",
        "notes/target.md": "# Target\n\nContent here.\n",
        "unrelated.md": "No links, though target is a word here.\n",
      },
      { kind: "file", path: "notes/target.md" },
      "archive/moved.md",
    );
    expect(alias).toBe("target");
    expect(byPath(writes)).toStrictEqual({
      "a.md": "Links to [[moved]] today.\n",
      "b.md": "See [details](archive/moved.md) for more.\n",
    });
    expect(writes.every((write) => !write.renamedNote)).toBe(true);
  });

  it("folds the alias into the renamed note's own rewrite, read from where it sat", () => {
    const { writes } = planOver(
      { "hub.md": "# Hub\n", "notes/target.md": "# Target\n\nUp to [hub](../hub.md).\n" },
      { kind: "file", path: "notes/target.md" },
      "archive/deep/moved.md",
    );
    const own = writes.find((write) => write.renamedNote);
    expect(own?.path).toBe("archive/deep/moved.md");
    expect(own?.from).toBe("notes/target.md");
    expect(own?.content).toBe(
      "---\naliases:\n  - target\n---\n# Target\n\nUp to [hub](../../hub.md).\n",
    );
  });

  it("qualifies a link whose alias the new name steals", () => {
    const { writes } = planOver(
      {
        "hub.md": "see [[Retro]]\n",
        "misc.md": "# Misc\n",
        "notes/owner.md": "---\naliases: [Retro]\n---\n# Owner\n",
      },
      { kind: "file", path: "misc.md" },
      "Retro.md",
    );
    expect(byPath(writes)).toStrictEqual({ "hub.md": "see [[notes/owner|Retro]]\n" });
  });

  it("retitles a [[Title|uuid]] link by its id, though its title is stale", () => {
    const uuid = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
    const { writes } = planOver(
      { "hub.md": `see [[Old Title|${uuid}]]\n`, "target.md": `---\nid: ${uuid}\n---\n# Target\n` },
      { kind: "file", path: "target.md" },
      "New Name.md",
    );
    expect(byPath(writes)).toStrictEqual({ "hub.md": `see [[New Name|${uuid}]]\n` });
  });

  it("moves every file under a folder, re-bases their links and owes no alias", () => {
    const { alias, writes } = planOver(
      {
        "hub.md": "Read [the note](proj/note.md), [[proj/note]], ![[proj/sibling]].\n",
        "proj/note.md":
          "# Note\n\nUp to [hub](../hub.md), across [sib](sibling.md) and [[proj/sibling]].\n",
        "proj/sibling.md": "# Sibling\n\nBack to [[note]].\n",
      },
      { kind: "dir", path: "proj" },
      "archive/project",
    );
    expect(alias).toBeNull();
    expect(byPath(writes)).toStrictEqual({
      "archive/project/note.md":
        "# Note\n\nUp to [hub](../../hub.md), across [sib](sibling.md) and [[sibling]].\n",
      "hub.md": "Read [the note](archive/project/note.md), [[note]], ![[sibling]].\n",
    });
    expect(writes.find((write) => write.path === "archive/project/note.md")?.from).toBe(
      "proj/note.md",
    );
  });
});

describe("the alias a rename owes", () => {
  it("is none for a case-only retitle, a folder, or a file that is not a note", () => {
    expect(renameAlias({ kind: "file", path: "plan.md" }, "Plan.md")).toBeNull();
    expect(renameAlias({ kind: "dir", path: "plan" }, "later")).toBeNull();
    expect(renameAlias({ kind: "file", path: "shot.png" }, "photo.png")).toBeNull();
    expect(renameAlias({ kind: "file", path: "a/plan.md" }, "b/plan.md")).toBeNull();
  });

  it("is the old stem when the name changes beyond its case", () => {
    expect(renameAlias({ kind: "file", path: "a/plan.md" }, "b/Roadmap.md")).toBe("plan");
  });
});
