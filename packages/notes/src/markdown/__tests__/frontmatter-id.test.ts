import { describe, expect, it } from "vitest";
import { frontmatterId, mintNoteId, withFrontmatterId } from "../frontmatter";

describe("the note's frontmatter id", () => {
  it("reads a text id and nothing else", () => {
    expect(frontmatterId("---\nid: abc\n---\nx\n")).toBe("abc");
    expect(frontmatterId("---\nid: 42\n---\nx\n")).toBeNull();
    expect(frontmatterId("---\nid:\n---\nx\n")).toBeNull();
    expect(frontmatterId("x\n")).toBeNull();
  });

  it("is minted uuid-shaped, the form the id link tier resolves", () => {
    expect(mintNoteId()).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/u);
  });

  it("is written first into a block, or as a new block, leaving every other line as found", () => {
    expect(withFrontmatterId("body\n", "new")).toEqual({
      content: "---\nid: new\n---\nbody\n",
      kind: "written",
    });
    expect(withFrontmatterId("---\ntags:\n  - a\npinned: true\n---\nbody\n", "new")).toEqual({
      content: "---\nid: new\ntags:\n  - a\npinned: true\n---\nbody\n",
      kind: "written",
    });
  });

  it("keeps an id the note carries, replaces an empty one, and refuses invalid YAML", () => {
    expect(withFrontmatterId("---\nid: mine\n---\nbody\n", "new")).toEqual({
      id: "mine",
      kind: "unchanged",
    });
    for (const empty of ["id:", 'id: ""', "id: ~", "id: null"]) {
      expect(withFrontmatterId(`---\n${empty}\ntitle: t\n---\nbody\n`, "new")).toEqual({
        content: "---\nid: new\ntitle: t\n---\nbody\n",
        kind: "written",
      });
    }
    expect(withFrontmatterId("---\n: [\n---\nbody\n", "new")).toEqual({ kind: "invalid" });
  });

  it("refuses to overwrite an id that is not text, naming it", () => {
    expect(withFrontmatterId("---\nid: 42\n---\nbody\n", "new")).toEqual({
      kind: "foreign-id",
      value: "42",
    });
    expect(withFrontmatterId("---\nid: 2024-01-01\n---\nbody\n", "new")).toEqual({
      kind: "foreign-id",
      value: '"2024-01-01"',
    });
    expect(withFrontmatterId("---\nid:\n  - a\n  - b\n---\nbody\n", "new")).toEqual({
      kind: "foreign-id",
      value: '["a","b"]',
    });
    expect(withFrontmatterId("---\nid: {a: 1}\n---\nbody\n", "new")).toEqual({
      kind: "foreign-id",
      value: "{a: 1}",
    });
  });

  it("reads a quoted key as the key, so an empty one is replaced rather than duplicated", () => {
    expect(withFrontmatterId('---\n"id": abc\n---\nbody\n', "new")).toEqual({
      id: "abc",
      kind: "unchanged",
    });
    expect(withFrontmatterId("---\n'id': 7\n---\nbody\n", "new")).toEqual({
      kind: "foreign-id",
      value: "7",
    });
    expect(withFrontmatterId('---\n"id": ""\ntitle: t\n---\nbody\n', "new")).toEqual({
      content: "---\nid: new\ntitle: t\n---\nbody\n",
      kind: "written",
    });
  });

  it("writes into a BOM note's own block and keeps its line ending", () => {
    expect(withFrontmatterId("\uFEFF---\ntitle: t\n---\nbody\n", "new")).toEqual({
      content: "\uFEFF---\nid: new\ntitle: t\n---\nbody\n",
      kind: "written",
    });
    expect(withFrontmatterId("---\r\ntitle: t\r\n---\r\nbody\r\n", "new")).toEqual({
      content: "---\r\nid: new\r\ntitle: t\r\n---\r\nbody\r\n",
      kind: "written",
    });
    expect(withFrontmatterId("\uFEFFbody\r\nmore\r\n", "new")).toEqual({
      content: "\uFEFF---\r\nid: new\r\n---\r\nbody\r\nmore\r\n",
      kind: "written",
    });
  });
});
