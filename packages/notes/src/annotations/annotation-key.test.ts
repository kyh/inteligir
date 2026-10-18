import { describe, expect, it } from "vitest";
import { annotationKeyOf, annotationStoreKey, newAnnotationRefusal } from "./annotation-key";

const ID = "9e64c3df-c1e2-4a4d-8c07-91528f422413";
const MINTED = "0d9c2a77-5f31-4c3b-9d5e-2b7f1a3c4e60";
const mint = (): string => MINTED;

describe("the id a note's annotations are keyed by", () => {
  it("reads the id a note carries and leaves its text alone", () => {
    const note = `---\nid: ${ID}\n---\n# Plan\n`;
    expect(annotationKeyOf(note, mint)).toStrictEqual({ content: note, id: ID, kind: "key" });
    expect(annotationKeyOf(note, null)).toStrictEqual({ content: note, id: ID, kind: "key" });
  });

  it("mints one into a note without, by the line cut, keeping every other line", () => {
    expect(annotationKeyOf("---\ntags: [a, b]\n---\n# Plan\n", mint)).toStrictEqual({
      content: `---\nid: ${MINTED}\ntags: [a, b]\n---\n# Plan\n`,
      id: MINTED,
      kind: "key",
    });
    expect(annotationKeyOf("# Plan\n", mint)).toStrictEqual({
      content: `---\nid: ${MINTED}\n---\n# Plan\n`,
      id: MINTED,
      kind: "key",
    });
  });

  it("mints nothing for a reply or an edit: a note without an id has no annotation", () => {
    expect(annotationKeyOf("# Plan\n", null)).toStrictEqual({
      kind: "refused",
      message: "This item has no highlights.",
    });
  });

  it("refuses frontmatter it cannot read, an id that is not text and one no file can carry", () => {
    expect(annotationKeyOf("---\ntags: [a\n---\n# Plan\n", mint)).toMatchObject({
      kind: "refused",
    });
    expect(annotationKeyOf("---\nid: 42\n---\n# Plan\n", mint)).toMatchObject({ kind: "refused" });
    expect(annotationKeyOf("---\nid: ../escape\n---\n# Plan\n", mint)).toMatchObject({
      kind: "refused",
    });
  });

  it("names the store a note's annotations are read from, and none for a note no store can key", () => {
    expect(annotationStoreKey(`---\nid: ${ID}\n---\n# Plan\n`)).toBe(ID);
    expect(annotationStoreKey("# Plan\n")).toBeNull();
    expect(annotationStoreKey("---\nid: ../escape\n---\n# Plan\n")).toBeNull();
  });

  it("answers whether a note takes a new annotation without minting anything", () => {
    expect(newAnnotationRefusal("# Plan\n")).toBeNull();
    expect(newAnnotationRefusal(`---\nid: ${ID}\n---\n# Plan\n`)).toBeNull();
    expect(newAnnotationRefusal("---\nid: 42\n---\n# Plan\n")).toBe(
      "This item's id isn't text, so it can't take a highlight.",
    );
  });
});
