import { describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/contract/library/library-nodes";

import { blockFromMarkdown, blockMarkdown, faithfulMarkdown, filesIn } from "./block-markdown";

const TARGET = "0190a000-0000-7000-8000-000000000001";
const SHA = "b".repeat(64);

const roundTrip = (block: LibraryBlock): LibraryBlock | null =>
  blockFromMarkdown(blockMarkdown(block), block.id, filesIn([block]));

describe("a block as its markdown", () => {
  it("names a linked item by its id, under the title it was written with", () => {
    const block: LibraryBlock = {
      children: [
        { text: "see " },
        { children: [{ text: "" }], key: TARGET, type: "mention", value: "Target" },
        { text: " and [[notes/Plan]]" },
      ],
      id: "p1",
      type: "p",
    };
    expect(blockMarkdown(block)).toBe(`see [Target](mention:${TARGET}) and \\[\\[notes/Plan]]\n`);
    expect(roundTrip(block)).toStrictEqual(block);
  });

  it("reads back a link to an item with no title by its id, so a merge can read its block", () => {
    const block: LibraryBlock = {
      children: [{ children: [{ text: "" }], key: TARGET, type: "mention", value: "" }],
      id: "p1",
      type: "p",
    };
    expect(blockMarkdown(block)).toBe(`[Untitled](mention:${TARGET})\n`);
    expect(roundTrip(block)).toStrictEqual(block);
    expect(faithfulMarkdown(block, filesIn([block]))).toBe(`[Untitled](mention:${TARGET})\n`);
  });

  it("writes a file the library holds at its sha, and reads it back as those bytes", () => {
    const image: LibraryBlock = { children: [{ text: "" }], id: "i1", sha: SHA, type: "img" };
    const file: LibraryBlock = {
      children: [{ text: "" }],
      id: "f1",
      name: "report.pdf",
      sha: SHA,
      type: "file",
    };
    expect(roundTrip(image)).toStrictEqual(image);
    expect(roundTrip(file)).toStrictEqual(file);
  });

  it("reads nothing back from markdown that holds two blocks", () => {
    expect(blockFromMarkdown("one\n\ntwo\n", "p1", new Map())).toBeNull();
  });
});
