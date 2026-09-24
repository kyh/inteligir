import { describe, expect, it } from "vitest";
import type { WikiTarget } from "../knowledge/link-graph-index";
import { rankWikiTargets } from "../knowledge/rank-wiki-targets";

const doc = (path: string, title: string, aliases?: string[]): WikiTarget => {
  const target: WikiTarget = { path, title, type: "doc" };
  if (aliases !== undefined) {
    target.aliases = aliases;
  }
  return target;
};

const paths = (targets: readonly WikiTarget[]): string[] => targets.map((target) => target.path);

describe("rankWikiTargets", () => {
  it("answers every target in listing order for a blank query", () => {
    const targets = [doc("b.md", "B"), doc("a.md", "A")];
    expect(paths(rankWikiTargets(targets, ""))).toEqual(["b.md", "a.md"]);
    expect(paths(rankWikiTargets(targets, "   "))).toEqual(["b.md", "a.md"]);
  });

  it("ranks a stem prefix, then a title prefix, then an alias prefix, then a word start, then a substring", () => {
    const targets = [
      doc("notes/unroadmapped.md", "Unroadmapped"),
      doc("projects/roadmap/plan.md", "Plan"),
      doc("notes/next quarter.md", "Next quarter", ["Q3 road"]),
      doc("notes/q3.md", "Q3", ["Roadmap Q3"]),
      doc("notes/plan.md", "Roadmap for 2027"),
      doc("notes/roadmap.md", "Roadmap"),
      doc("notes/other.md", "Other"),
    ];
    expect(paths(rankWikiTargets(targets, "road"))).toEqual([
      "notes/roadmap.md",
      "notes/plan.md",
      "notes/q3.md",
      "notes/next quarter.md",
      "notes/unroadmapped.md",
      "projects/roadmap/plan.md",
    ]);
  });

  it("keeps the listing's order within a rank", () => {
    const targets = [doc("z/road b.md", "Road B"), doc("a/road a.md", "Road A")];
    expect(paths(rankWikiTargets(targets, "road"))).toEqual(["z/road b.md", "a/road a.md"]);
  });

  it("matches case- and accent-blind", () => {
    const targets = [doc("notes/Café.md", "Café"), doc("notes/cafeteria.md", "Cafeteria")];
    expect(paths(rankWikiTargets(targets, "CAFE"))).toEqual([
      "notes/Café.md",
      "notes/cafeteria.md",
    ]);
  });

  it("matches typed words in any order at word starts", () => {
    const targets = [doc("notes/weekly review.md", "Weekly review"), doc("notes/w.md", "W")];
    expect(paths(rankWikiTargets(targets, "rev week"))).toEqual(["notes/weekly review.md"]);
  });

  it("ranks an attachment by its file name like a note by its stem", () => {
    const targets: WikiTarget[] = [
      doc("notes/diagrams.md", "Diagrams"),
      { path: "assets/diagram.png", title: "diagram.png", type: "asset" },
    ];
    expect(paths(rankWikiTargets(targets, "diagram.p"))).toEqual(["assets/diagram.png"]);
  });

  it("ranks a non-md note by the name its link spells, extension included", () => {
    const targets = [
      doc("archive/todo.txt", "todo"),
      doc("a/todo.txt.backup.md", "todo.txt.backup"),
      doc("todo.txt-notes.md", "todo.txt-notes"),
    ];
    expect(paths(rankWikiTargets(targets, "todo.txt"))).toEqual([
      "archive/todo.txt",
      "a/todo.txt.backup.md",
      "todo.txt-notes.md",
    ]);
    const typing = [doc("notes/tips.md", "Todo.txt tips"), doc("archive/todo.txt", "todo")];
    expect(paths(rankWikiTargets(typing, "todo.t"))).toEqual(["archive/todo.txt", "notes/tips.md"]);
  });
});
