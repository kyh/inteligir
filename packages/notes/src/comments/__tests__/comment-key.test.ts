import { describe, expect, it } from "vitest";
import { commentKeyOf, newCommentRefusal } from "../comment-key";

const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
const MINTED = "0d9c2a77-5f31-4c3b-9d5e-2b7f1a3c4e60";
const mint = (): string => MINTED;

describe("the id a note's comments are keyed by", () => {
  it("reads the id a note carries and leaves its text alone", () => {
    const note = `---\nid: ${ID}\n---\n# Plan\n`;
    expect(commentKeyOf(note, mint)).toStrictEqual({ content: note, id: ID, kind: "key" });
    expect(commentKeyOf(note, null)).toStrictEqual({ content: note, id: ID, kind: "key" });
  });

  it("mints one into a note without, by the line cut, keeping every other line", () => {
    expect(commentKeyOf("---\ntags: [a, b]\n---\n# Plan\n", mint)).toStrictEqual({
      content: `---\nid: ${MINTED}\ntags: [a, b]\n---\n# Plan\n`,
      id: MINTED,
      kind: "key",
    });
    expect(commentKeyOf("# Plan\n", mint)).toStrictEqual({
      content: `---\nid: ${MINTED}\n---\n# Plan\n`,
      id: MINTED,
      kind: "key",
    });
  });

  it("mints nothing for a reply or a resolve: a note without an id has no thread", () => {
    expect(commentKeyOf("# Plan\n", null)).toStrictEqual({
      kind: "refused",
      message: "This note has no comments.",
    });
  });

  it("refuses frontmatter it cannot read, an id that is not text and one no file can carry", () => {
    expect(commentKeyOf("---\ntags: [a\n---\n# Plan\n", mint)).toMatchObject({ kind: "refused" });
    expect(commentKeyOf("---\nid: 42\n---\n# Plan\n", mint)).toMatchObject({ kind: "refused" });
    expect(commentKeyOf("---\nid: ../escape\n---\n# Plan\n", mint)).toMatchObject({
      kind: "refused",
    });
  });

  it("answers whether a note takes a new comment without minting anything", () => {
    expect(newCommentRefusal("# Plan\n")).toBeNull();
    expect(newCommentRefusal(`---\nid: ${ID}\n---\n# Plan\n`)).toBeNull();
    expect(newCommentRefusal("---\nid: 42\n---\n# Plan\n")).toBe(
      "This note's id isn't text, so it can't take a comment.",
    );
  });
});
