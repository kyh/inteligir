import { describe, expect, it } from "vitest";
import {
  frontmatterId,
  frontmatterYamlWithId,
  mintNoteId,
  reassignFrontmatterId,
  withFrontmatterId,
} from "../frontmatter";

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

  it("makes the same cut over a block's own YAML, the form the editor's frontmatter node holds", () => {
    expect(frontmatterYamlWithId(null, "new")).toEqual({ kind: "written", yaml: "id: new" });
    expect(frontmatterYamlWithId("title: t\nid:", "new")).toEqual({
      kind: "written",
      yaml: "id: new\ntitle: t",
    });
    expect(frontmatterYamlWithId("id: mine", "new")).toEqual({ id: "mine", kind: "unchanged" });
    expect(frontmatterYamlWithId(": [", "new")).toEqual({ kind: "invalid" });
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

describe("a copy taking an id of its own", () => {
  const FROM = "0f6a3b1e-5c2d-4e8f-9a7b-1c3d5e7f9a0b";

  it("takes the new id on the line the shared one stood on, every other byte as found", () => {
    expect(
      reassignFrontmatterId(
        `---\ntitle: Plan\nid: ${FROM}\ntags: [a,  b]\n---\n%%i:c1:start%%x%%i:c1:end%%\n`,
        FROM,
        "new",
      ),
    ).toEqual({
      content: "---\ntitle: Plan\nid: new\ntags: [a,  b]\n---\n%%i:c1:start%%x%%i:c1:end%%\n",
      kind: "written",
    });
  });

  it("reads a quoted key or value as the id, and keeps a CRLF note's endings and its BOM", () => {
    expect(reassignFrontmatterId(`---\n"id": "${FROM}"\n---\nbody\n`, FROM, "new")).toEqual({
      content: "---\nid: new\n---\nbody\n",
      kind: "written",
    });
    expect(
      reassignFrontmatterId(
        `\uFEFF---\r\nid: ${FROM}\r\npinned: true\r\n---\r\nbody\r\n`,
        FROM,
        "new",
      ),
    ).toEqual({
      content: "\uFEFF---\r\nid: new\r\npinned: true\r\n---\r\nbody\r\n",
      kind: "written",
    });
  });

  it("writes nothing over an id the caller did not see: another one, none, or one not text", () => {
    for (const content of [
      "---\nid: moved\n---\nbody\n",
      "---\ntitle: t\n---\nbody\n",
      "body\n",
      "---\nid: 42\n---\nbody\n",
    ]) {
      expect(reassignFrontmatterId(content, FROM, "new")).toEqual({ kind: "changed" });
    }
  });

  it("refuses frontmatter it cannot read", () => {
    expect(reassignFrontmatterId(`---\nid: ${FROM}\n: [\n---\nbody\n`, FROM, "new")).toEqual({
      kind: "invalid",
    });
  });
});
