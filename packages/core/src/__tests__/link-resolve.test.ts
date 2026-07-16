import { describe, expect, it } from "vitest";

import { buildResolver } from "../knowledge/link-resolve";

describe("resolveWiki — precedence", () => {
  it("exact path beats basename", () => {
    const r = buildResolver(["target.md", "wiki/target.md"]);
    expect(r.resolveWiki("wiki/target")).toBe("wiki/target.md");
    expect(r.resolveWiki("target")).toBe("target.md");
  });

  it("resolves bare names by basename anywhere in the vault", () => {
    const r = buildResolver(["deep/nested/note.md", "other.md"]);
    expect(r.resolveWiki("note")).toBe("deep/nested/note.md");
  });

  it("breaks basename ambiguity toward the root, then lexicographically", () => {
    const r = buildResolver(["b/note.md", "a/deep/note.md", "a/note.md"]);
    expect(r.resolveWiki("note")).toBe("a/note.md");
  });

  it("resolves path suffixes", () => {
    const r = buildResolver(["x/sub/note.md", "other/note.md"]);
    expect(r.resolveWiki("sub/note")).toBe("x/sub/note.md");
  });

  it("falls back case-insensitively within each tier", () => {
    const r = buildResolver(["notes/Target Note.md"]);
    expect(r.resolveWiki("target note")).toBe("notes/Target Note.md");
    expect(r.resolveWiki("notes/target note")).toBe("notes/Target Note.md");
  });

  it("prefers a case-sensitive basename match over a case-insensitive one", () => {
    const r = buildResolver(["a/Note.md", "b/note.md"]);
    expect(r.resolveWiki("note")).toBe("b/note.md");
    expect(r.resolveWiki("Note")).toBe("a/Note.md");
  });

  it("requires explicit extensions for non-md files", () => {
    const r = buildResolver(["img/diagram.png", "notes/doc.txt"]);
    expect(r.resolveWiki("diagram.png")).toBe("img/diagram.png");
    expect(r.resolveWiki("diagram")).toBeNull();
    expect(r.resolveWiki("doc.txt")).toBe("notes/doc.txt");
    expect(r.resolveWiki("doc")).toBeNull();
  });

  it("accepts an explicit .md extension", () => {
    const r = buildResolver(["a/note.md"]);
    expect(r.resolveWiki("note.md")).toBe("a/note.md");
  });

  it("returns null for unknown and root-escaping targets", () => {
    const r = buildResolver(["a/note.md"]);
    expect(r.resolveWiki("missing")).toBeNull();
    expect(r.resolveWiki("../outside")).toBeNull();
    expect(r.resolveWiki("")).toBeNull();
  });
});

describe("resolveWiki — alias tiers", () => {
  it("resolves an alias when every path tier misses", () => {
    const r = buildResolver(["notes/retrospective.md"], [["Retro", "notes/retrospective.md"]]);
    expect(r.resolveWiki("Retro")).toBe("notes/retrospective.md");
  });

  it("a real filename always beats an alias — exact, basename, and suffix", () => {
    const r = buildResolver(
      ["retro.md", "a/sub/plan.md", "owner.md"],
      [
        ["retro", "owner.md"],
        ["sub/plan", "owner.md"],
      ],
    );
    expect(r.resolveWiki("retro")).toBe("retro.md"); // basename tier wins
    expect(r.resolveWiki("sub/plan")).toBe("a/sub/plan.md"); // suffix tier wins
  });

  it("case-sensitive alias beats case-insensitive alias", () => {
    const r = buildResolver(
      ["a.md", "b.md"],
      [
        ["Retro", "a.md"],
        ["retro", "b.md"],
      ],
    );
    expect(r.resolveWiki("Retro")).toBe("a.md");
    expect(r.resolveWiki("retro")).toBe("b.md");
    expect(r.resolveWiki("RETRO")).toBe("a.md"); // ci tier, pickBest over both owners
  });

  it("aliases may contain a slash (reached from the slashed branch)", () => {
    const r = buildResolver(["deep/owner.md"], [["projects/big one", "deep/owner.md"]]);
    expect(r.resolveWiki("projects/big one")).toBe("deep/owner.md");
  });

  it("collisions break deterministically (pickBest), independent of insertion order", () => {
    const entries: Array<readonly [string, string]> = [
      ["shared", "z/deep/nested.md"],
      ["shared", "b/note.md"],
      ["shared", "a-longer-name.md"],
      ["shared", "a.md"],
    ];
    const paths = ["z/deep/nested.md", "b/note.md", "a-longer-name.md", "a.md"];
    // Fewest segments, then shortest, then lexicographic — for every permutation.
    for (let i = 0; i < entries.length; i++) {
      const rotatedEntries = [...entries.slice(i), ...entries.slice(0, i)];
      const rotatedPaths = [...paths.slice(i), ...paths.slice(0, i)];
      const r = buildResolver(rotatedPaths, rotatedEntries);
      expect(r.resolveWiki("shared")).toBe("a.md");
    }
  });

  it("blank aliases and blank owners are ignored", () => {
    const r = buildResolver(
      ["a.md"],
      [
        ["  ", "a.md"],
        ["ok", ""],
        ["real", "a.md"],
      ],
    );
    expect(r.resolveWiki("real")).toBe("a.md");
    expect(r.resolveWiki("ok")).toBeNull();
    expect(r.resolveWiki("  ")).toBeNull();
  });

  it("aliases are wiki-only — resolveMd never consults them", () => {
    const r = buildResolver(["owner.md"], [["Retro", "owner.md"]]);
    expect(r.resolveMd("Retro", "somewhere.md")).toBeNull();
  });
});

describe("resolveMd", () => {
  const r = buildResolver(["a/b.md", "a/c.md", "x.md", "docs/guide.md", "a/img.png"]);

  it("resolves relative to the linking doc's directory", () => {
    expect(r.resolveMd("c.md", "a/b.md")).toBe("a/c.md");
    expect(r.resolveMd("./c.md", "a/b.md")).toBe("a/c.md");
    expect(r.resolveMd("../x.md", "a/b.md")).toBe("x.md");
    expect(r.resolveMd("img.png", "a/b.md")).toBe("a/img.png");
  });

  it("falls back to vault-root-relative", () => {
    expect(r.resolveMd("docs/guide.md", "a/b.md")).toBe("docs/guide.md");
  });

  it("tries .md for extension-less urls", () => {
    expect(r.resolveMd("c", "a/b.md")).toBe("a/c.md");
  });

  it("is case-insensitive as a fallback", () => {
    expect(r.resolveMd("C.MD", "a/b.md")).toBe("a/c.md");
  });

  it("returns null for escapes and misses", () => {
    expect(r.resolveMd("../../etc/passwd", "a/b.md")).toBeNull();
    expect(r.resolveMd("nope.md", "a/b.md")).toBeNull();
  });
});
