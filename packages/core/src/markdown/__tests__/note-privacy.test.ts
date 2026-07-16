// notePrivacy — the pure `private: true` read every privacy surface derives
// from. Strictness matters (SECURITY): only a boolean true is private, and a
// frontmatter block we cannot type is "indeterminate" so AI paths can treat
// it as private (fail-closed) while the UI shows no lock.

import { describe, expect, it } from "vitest";

import { notePrivacy } from "../frontmatter";

describe("notePrivacy", () => {
  it("no frontmatter → public", () => {
    expect(notePrivacy("# Hello\n\nbody\n")).toBe("public");
    expect(notePrivacy("")).toBe("public");
  });

  it("private: true → private", () => {
    expect(notePrivacy("---\nprivate: true\n---\n# T\n")).toBe("private");
  });

  it("private: true among other keys → private", () => {
    expect(notePrivacy("---\ntitle: x\nprivate: true\ntags: [a]\n---\nbody\n")).toBe("private");
  });

  it("private: false → public", () => {
    expect(notePrivacy("---\nprivate: false\n---\n")).toBe("public");
  });

  it('private: "true" (string) stays text → public', () => {
    expect(notePrivacy('---\nprivate: "true"\n---\n')).toBe("public");
  });

  it("private: yes stays text per the YAML core schema → public", () => {
    expect(notePrivacy("---\nprivate: yes\n---\n")).toBe("public");
  });

  it("malformed yaml → indeterminate", () => {
    expect(notePrivacy("---\n[not: valid: yaml\n---\n")).toBe("indeterminate");
  });

  it("duplicate keys → indeterminate", () => {
    expect(notePrivacy("---\nprivate: false\nprivate: true\n---\n")).toBe("indeterminate");
  });

  it("non-mapping frontmatter root → indeterminate", () => {
    expect(notePrivacy("---\n- just\n- a list\n---\n")).toBe("indeterminate");
  });

  it("empty block → public", () => {
    expect(notePrivacy("---\n---\nbody\n")).toBe("public");
  });

  it("CRLF frontmatter → private", () => {
    expect(notePrivacy("---\r\nprivate: true\r\n---\r\nbody\r\n")).toBe("private");
  });

  it("frontmatter not at byte 0 is not frontmatter → public", () => {
    expect(notePrivacy("\n---\nprivate: true\n---\n")).toBe("public");
    expect(notePrivacy("text first\n---\nprivate: true\n---\n")).toBe("public");
  });
});
