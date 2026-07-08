import { describe, expect, it } from "vitest";

import {
  applyPropertiesPatch,
  serializeDoc,
  splitFrontmatter,
} from "@repo/core/markdown/frontmatter";

describe("splitFrontmatter", () => {
  it("returns empty properties + full body when there is no frontmatter", () => {
    const text = "# Hello\n\nbody text\n";
    expect(splitFrontmatter(text)).toEqual({
      properties: {},
      body: text,
      hadFrontmatter: false,
    });
  });

  it("parses a leading yaml block into a mapping and keeps the body verbatim", () => {
    const text = "---\ntitle: Note\ntags:\n  - a\n  - b\n---\n# Body\n\ntext\n";
    const split = splitFrontmatter(text);
    expect(split.hadFrontmatter).toBe(true);
    expect(split.properties).toEqual({ title: "Note", tags: ["a", "b"] });
    expect(split.body).toBe("# Body\n\ntext\n");
  });

  it("does not treat a mid-document --- as frontmatter", () => {
    const text = "para\n\n---\n\nmore\n";
    const split = splitFrontmatter(text);
    expect(split.hadFrontmatter).toBe(false);
    expect(split.body).toBe(text);
  });

  it("treats empty frontmatter as an empty mapping", () => {
    const split = splitFrontmatter("---\n---\nbody\n");
    expect(split.hadFrontmatter).toBe(true);
    expect(split.properties).toEqual({});
    expect(split.body).toBe("body\n");
  });

  it("treats a non-mapping frontmatter as empty properties without throwing", () => {
    const split = splitFrontmatter("---\n- just\n- a list\n---\nbody\n");
    expect(split.hadFrontmatter).toBe(true);
    expect(split.properties).toEqual({});
  });
});

describe("serializeDoc", () => {
  it("emits no fence for empty properties", () => {
    expect(serializeDoc({}, "# Body\n")).toBe("# Body\n");
  });

  it("emits a --- fenced yaml block then the body", () => {
    expect(serializeDoc({ title: "X" }, "# Body\n")).toBe("---\ntitle: X\n---\n# Body\n");
  });

  it("round-trips split → serialize for a doc with frontmatter", () => {
    const text = "---\ntitle: Note\ncount: 3\n---\nbody line\n";
    const { properties, body } = splitFrontmatter(text);
    expect(serializeDoc(properties, body)).toBe(text);
  });
});

describe("applyPropertiesPatch", () => {
  it("adds and replaces keys, preserving omitted ones", () => {
    expect(applyPropertiesPatch({ a: 1, b: 2 }, { b: 3, c: 4 })).toEqual({ a: 1, b: 3, c: 4 });
  });

  it("deletes a key whose patch value is null", () => {
    expect(applyPropertiesPatch({ a: 1, b: 2 }, { a: null })).toEqual({ b: 2 });
  });

  it("does not mutate the input mapping", () => {
    const current = { a: 1 };
    applyPropertiesPatch(current, { a: 2 });
    expect(current).toEqual({ a: 1 });
  });
});
