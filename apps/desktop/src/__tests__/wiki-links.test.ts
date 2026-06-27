import { describe, expect, it } from "vitest";

import { computeNoteLinks } from "@/main/vault-links";
import { parseWikiLinks, resolveWikiTarget } from "@/shared/wiki-links";

describe("parseWikiLinks", () => {
  it("extracts simple links", () => {
    const links = parseWikiLinks("See [[Project Plan]] and [[Ideas]].");
    expect(links.map((l) => l.target)).toEqual(["Project Plan", "Ideas"]);
    expect(links[0]?.alias).toBeNull();
  });

  it("extracts aliased links", () => {
    const [link] = parseWikiLinks("[[2026-06-26|today's note]]");
    expect(link?.target).toBe("2026-06-26");
    expect(link?.alias).toBe("today's note");
  });

  it("ignores empty targets and reports offsets", () => {
    const links = parseWikiLinks("a [[]] b [[X]]");
    expect(links).toHaveLength(1);
    expect(links[0]?.target).toBe("X");
    expect("a [[]] b ".length).toBe(links[0]?.start);
  });
});

describe("resolveWikiTarget", () => {
  const paths = ["inbox.md", "projects/q3.md", "projects/Project Plan.md"];

  it("resolves a bare name by basename, case-insensitively", () => {
    expect(resolveWikiTarget("project plan", paths)).toBe("projects/Project Plan.md");
    expect(resolveWikiTarget("Inbox", paths)).toBe("inbox.md");
  });

  it("resolves a path-qualified target", () => {
    expect(resolveWikiTarget("projects/q3", paths)).toBe("projects/q3.md");
  });

  it("returns null for an unmatched target", () => {
    expect(resolveWikiTarget("nonexistent", paths)).toBeNull();
  });

  it("ignores a .md suffix in the target", () => {
    expect(resolveWikiTarget("inbox.md", paths)).toBe("inbox.md");
  });
});

describe("computeNoteLinks", () => {
  const docs = [
    { path: "a.md", content: "Links to [[B]] and [[Missing]]." },
    { path: "b.md", content: "# B\n\nback to [[A]]." },
    { path: "c.md", content: "Also references [[B]]." },
  ];

  it("resolves outgoing links and flags broken ones", () => {
    const links = computeNoteLinks("a.md", docs);
    expect(links.outgoing).toEqual([
      { target: "B", alias: null, path: "b.md" },
      { target: "Missing", alias: null, path: null },
    ]);
  });

  it("collects backlinks from every note that links here", () => {
    const links = computeNoteLinks("b.md", docs);
    expect(links.backlinks).toEqual(["a.md", "c.md"]);
  });

  it("dedupes repeated outgoing targets", () => {
    const links = computeNoteLinks("x.md", [
      { path: "x.md", content: "[[B]] [[B]] [[b]]" },
      { path: "b.md", content: "" },
    ]);
    expect(links.outgoing).toHaveLength(1);
  });

  it("returns empty relationships for an isolated note", () => {
    const links = computeNoteLinks("lonely.md", [{ path: "lonely.md", content: "no links here" }]);
    expect(links).toEqual({ outgoing: [], backlinks: [] });
  });
});
