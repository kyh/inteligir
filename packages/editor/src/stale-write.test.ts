import { mergeBlocks } from "@repo/editor/stale-write";
import type { LibraryBlock, LibraryNode } from "@repo/notes/library/library-nodes";
import { describe, expect, it } from "vitest";

const code = (id: string, lines: readonly string[]): LibraryBlock => ({
  children: lines.map((text) => ({ children: [{ text }], type: "code_line" })),
  id,
  type: "code_block",
});

const words = (id: string, ...children: LibraryNode[]): LibraryBlock => ({
  children,
  id,
  type: "p",
});

const linesOf = (block: LibraryBlock): string[] =>
  block.children.map((line) =>
    "text" in line
      ? line.text
      : line.children.map((leaf) => ("text" in leaf ? leaf.text : "")).join(""),
  );

const TARGET = "0190a000-0000-7000-8000-000000000001";

// a paragraph whose text ends in a blank line, which no markdown reads back as one paragraph
const odd = (text: string): LibraryBlock => words("p1", { text: `${text}\n\n` });

describe("two writers' edits to one block", () => {
  it("lands the lines each side changed, under the id the cell holds", () => {
    const base = code("b1", ["one", "two", "three"]);
    const merged = mergeBlocks({
      base,
      mine: code("b1", ["one, from the phone", "two", "three"]),
      theirs: code("b1", ["one", "two", "three, from the Mac"]),
    });
    expect(merged.overlapped).toBe(false);
    expect(merged.block.id).toBe("b1");
    expect(linesOf(merged.block)).toStrictEqual([
      "one, from the phone",
      "two",
      "three, from the Mac",
    ]);
  });

  it("keeps mine where both sides changed the same line, and says so", () => {
    const merged = mergeBlocks({
      base: code("b1", ["one", "two"]),
      mine: code("b1", ["mine", "two"]),
      theirs: code("b1", ["theirs", "two"]),
    });
    expect(merged.overlapped).toBe(true);
    expect(linesOf(merged.block)).toStrictEqual(["mine", "two"]);
  });

  it("keeps a link's item through a merge that reads the block again", () => {
    const link: LibraryNode = {
      children: [{ text: "" }],
      itemId: TARGET,
      title: "Target",
      type: "wikiLink",
    };
    const quote = (first: string, last: string): LibraryBlock => ({
      children: [
        { children: [{ text: first }], type: "p" },
        { children: [{ text: "see " }, link, { text: last }], type: "p" },
      ],
      id: "q1",
      type: "blockquote",
    });
    const merged = mergeBlocks({
      base: quote("first", " soon"),
      mine: quote("first, mine", " soon"),
      theirs: quote("first", " soon, theirs"),
    });
    // the merged block names its ref whichever side moved it, here neither
    expect(merged).toStrictEqual({
      block: { ...quote("first, mine", " soon, theirs"), ref: undefined },
      overlapped: false,
    });
  });

  it("takes the ref the side that moved it gave, whichever side that was", () => {
    const base = { ...code("b1", ["one"]), ref: "old" };
    expect(mergeBlocks({ base, mine: { ...base, ref: "mine" }, theirs: base }).block.ref).toBe(
      "mine",
    );
    expect(mergeBlocks({ base, mine: base, theirs: { ...base, ref: "theirs" } }).block.ref).toBe(
      "theirs",
    );
  });

  it("keeps mine whole for a block whose markdown does not read back as itself, and says so", () => {
    const merged = mergeBlocks({ base: odd("a"), mine: odd("mine"), theirs: odd("theirs") });
    expect(merged).toMatchObject({
      block: { children: [{ text: "mine\n\n" }], id: "p1" },
      overlapped: true,
    });
  });
});
