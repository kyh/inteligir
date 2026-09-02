import { describe, expect, it } from "vitest";

import { addFrontmatterAlias, splitFrontmatter } from "@repo/notes/markdown/frontmatter";

describe("splitFrontmatter", () => {
  it("returns empty properties + full body when there is no frontmatter", () => {
    const text = "# Hello\n\nbody text\n";
    expect(splitFrontmatter(text)).toEqual({
      properties: {},
      body: text,
    });
  });

  it("parses a leading yaml block into a mapping and keeps the body verbatim", () => {
    const text = "---\ntitle: Note\ntags:\n  - a\n  - b\n---\n# Body\n\ntext\n";
    const split = splitFrontmatter(text);
    expect(split.properties).toEqual({ title: "Note", tags: ["a", "b"] });
    expect(split.body).toBe("# Body\n\ntext\n");
  });

  it("does not treat a mid-document --- as frontmatter", () => {
    const text = "para\n\n---\n\nmore\n";
    const split = splitFrontmatter(text);
    expect(split.properties).toEqual({});
    expect(split.body).toBe(text);
  });

  it("treats empty frontmatter as an empty mapping", () => {
    const split = splitFrontmatter("---\n---\nbody\n");
    expect(split.properties).toEqual({});
    expect(split.body).toBe("body\n");
  });

  it("treats a non-mapping frontmatter as empty properties without throwing", () => {
    const split = splitFrontmatter("---\n- just\n- a list\n---\nbody\n");
    expect(split.properties).toEqual({});
  });
});

describe("addFrontmatterAlias", () => {
  it("creates a frontmatter block on a doc that had none, body byte-exact", () => {
    const body = "# Old Title\n\nSome text.\n";
    expect(addFrontmatterAlias(body, "Old Title")).toBe(
      "---\naliases:\n  - Old Title\n---\n# Old Title\n\nSome text.\n",
    );
  });

  it("appends to an existing string array, preserving other keys byte-exactly", () => {
    const doc = "---\ntitle: Note # keep me\naliases:\n  - First\n---\nbody\n";
    expect(addFrontmatterAlias(doc, "Second")).toBe(
      "---\ntitle: Note # keep me\naliases:\n  - First\n  - Second\n---\nbody\n",
    );
  });

  it("adds the key to existing frontmatter, preserving block-style neighbors", () => {
    const doc = "---\npublished: true # keep\ntags:\n  - a\n---\nbody\n";
    expect(addFrontmatterAlias(doc, "New Name")).toBe(
      "---\npublished: true # keep\ntags:\n  - a\naliases:\n  - New Name\n---\nbody\n",
    );
  });

  it("appends to a legacy alias: array instead of shadowing it with aliases:", () => {
    const doc = "---\nalias:\n  - Old\n---\nbody\n";
    expect(addFrontmatterAlias(doc, "Newer")).toBe("---\nalias:\n  - Old\n  - Newer\n---\nbody\n");
  });

  it("returns null when the alias is already present case-insensitively", () => {
    expect(addFrontmatterAlias("---\naliases: [Retro]\n---\nx\n", "retro")).toBeNull();
    expect(addFrontmatterAlias("---\naliases: [Retro]\n---\nx\n", " RETRO ")).toBeNull();
  });

  it("returns null when the alias-list key is not a string array", () => {
    expect(addFrontmatterAlias("---\naliases: plain string\n---\nx\n", "A")).toBeNull();
    expect(addFrontmatterAlias("---\naliases: 42\n---\nx\n", "A")).toBeNull();
    expect(addFrontmatterAlias("---\naliases: {a: b}\n---\nx\n", "A")).toBeNull();
    expect(addFrontmatterAlias("---\nalias: scalar\n---\nx\n", "A")).toBeNull();
  });

  it("returns null on frontmatter it cannot type (never rewrite the unreadable)", () => {
    expect(addFrontmatterAlias("---\na: [unclosed\n---\nx\n", "A")).toBeNull();
    expect(addFrontmatterAlias("---\ndup: 1\ndup: 2\n---\nx\n", "A")).toBeNull();
  });

  it("returns null for a blank alias", () => {
    expect(addFrontmatterAlias("body\n", "  ")).toBeNull();
  });

  it("treats an empty frontmatter block as absent properties (block replaced)", () => {
    expect(addFrontmatterAlias("---\n---\nbody\n", "Name")).toBe(
      "---\naliases:\n  - Name\n---\nbody\n",
    );
  });
});
