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
    expect(withFrontmatterId("body\n", "new")).toBe("---\nid: new\n---\nbody\n");
    expect(withFrontmatterId("---\ntags:\n  - a\npinned: true\n---\nbody\n", "new")).toBe(
      "---\nid: new\ntags:\n  - a\npinned: true\n---\nbody\n",
    );
  });

  it("keeps an id the note carries, replaces an empty one, and refuses invalid YAML", () => {
    const owned = "---\nid: mine\n---\nbody\n";
    expect(withFrontmatterId(owned, "new")).toBe(owned);
    expect(withFrontmatterId("---\nid:\ntitle: t\n---\nbody\n", "new")).toBe(
      "---\nid: new\ntitle: t\n---\nbody\n",
    );
    expect(withFrontmatterId("---\n: [\n---\nbody\n", "new")).toBeNull();
  });
});
