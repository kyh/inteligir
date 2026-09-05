import { describe, expect, it } from "vitest";
import { KnowledgeIndex } from "../knowledge/knowledge-index";
import { isConventionFolderPath } from "../knowledge/vault-problems";

function seeded(): KnowledgeIndex {
  const index = new KnowledgeIndex();
  index.setDoc("Welcome.md", "# Welcome\n\nSee [[Nowhere]] and again [[nowhere]] and [[Guide]].\n");
  index.setDoc(
    "Guide.md",
    "# Guide\n\nBack to [[Welcome]]. A photo: ![[missing.png]] and ![](gone.jpg).\n",
  );
  index.setDoc("Lonely.md", "# Lonely\n\nLinks to [[Lonely]] itself only.\n");
  index.setDoc("notes/daily/2026-09-05.md", "# Today\n");
  index.setDoc("templates/Meeting.md", "# {{title}}\n");
  index.setDoc("a/Guide.md", "# Another guide\n\n[[Welcome]]\n");
  index.setOther("assets/logo.png");
  return index;
}

describe("unresolved links", () => {
  it("lists a dangling wiki link once per source, with its line, and drops it once the note exists", () => {
    const index = seeded();
    const before = index.problems({ limit: 50 });
    expect(before.unresolvedLinks.rows).toEqual([
      {
        sourcePath: "Welcome.md",
        sourceTitle: "Welcome",
        target: "Nowhere",
        line: 3,
        snippet: "See [[Nowhere]] and again [[nowhere]] and [[Guide]].",
        kind: "wiki",
        embed: false,
      },
    ]);
    expect(before.unresolvedLinks.total).toBe(1);

    index.setDoc("Nowhere.md", "# Nowhere\n");
    expect(index.problems({ limit: 50 }).unresolvedLinks.rows).toEqual([]);
  });

  it("files an embed of a missing file, and a dangling asset reference, as a missing embed", () => {
    const rows = seeded().problems({ limit: 50 }).missingEmbeds.rows;
    expect(rows.map((row) => [row.target, row.kind, row.embed])).toEqual([
      ["missing.png", "wiki", true],
      ["gone.jpg", "image", true],
    ]);
    expect(rows.every((row) => row.sourcePath === "Guide.md")).toBe(true);
  });
});

describe("orphans", () => {
  it("is a doc nothing else links to; a self-link does not count", () => {
    const orphans = seeded().problems({ limit: 50 }).orphans;
    expect(orphans.rows.map((row) => row.path)).toEqual(["Lonely.md", "a/Guide.md"]);
    expect(orphans.total).toBe(2);
  });

  it("leaves daily notes and templates out unless asked", () => {
    const withConventions = seeded().problems({ limit: 50, includeConventionFolders: true });
    expect(withConventions.orphans.rows.map((row) => row.path)).toEqual([
      "Lonely.md",
      "a/Guide.md",
      "notes/daily/2026-09-05.md",
      "templates/Meeting.md",
    ]);
    expect(isConventionFolderPath("notes/daily/x.md")).toBe(true);
    expect(isConventionFolderPath("templates/x.md")).toBe(true);
    expect(isConventionFolderPath("notes/dailyish/x.md")).toBe(false);
  });
});

describe("duplicate stems", () => {
  it("groups docs sharing a stem across folders, any case", () => {
    const duplicates = seeded().problems({ limit: 50 }).duplicateStems;
    expect(duplicates.rows).toEqual([{ stem: "Guide", paths: ["Guide.md", "a/Guide.md"] }]);
    expect(duplicates.total).toBe(1);
  });
});

describe("the cap", () => {
  it("applies per family and keeps the totals honest", () => {
    const index = new KnowledgeIndex();
    index.setDoc("a.md", "[[x1]] [[x2]] [[x3]]\n");
    index.setDoc("b.md", "# B\n");
    const problems = index.problems({ limit: 2 });
    expect(problems.unresolvedLinks.rows).toHaveLength(2);
    expect(problems.unresolvedLinks.total).toBe(3);
    expect(problems.orphans.rows.map((row) => row.path)).toEqual(["a.md", "b.md"]);
  });
});
