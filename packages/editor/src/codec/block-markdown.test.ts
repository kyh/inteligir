import { describe, expect, it } from "vitest";

import type { LibraryBlock } from "@repo/notes/library/library-nodes";

import { blockFromMarkdown, blockMarkdown, faithfulMarkdown, filesIn } from "./block-markdown";

const TARGET = "0190a000-0000-7000-8000-000000000001";
const SHA = "b".repeat(64);

const roundTrip = (block: LibraryBlock): LibraryBlock | null =>
  blockFromMarkdown(blockMarkdown(block), block.id, filesIn([block]));

describe("a block as its markdown", () => {
  it("names a linked item by its id and a waiting link by the title it was written with", () => {
    const block: LibraryBlock = {
      children: [
        { text: "see " },
        { children: [{ text: "" }], itemId: TARGET, title: "Target", type: "wikiLink" },
        { text: " and " },
        { children: [{ text: "" }], itemId: null, title: "notes/Plan", type: "wikiLink" },
      ],
      id: "p1",
      type: "p",
    };
    expect(blockMarkdown(block)).toBe(`see [[Target|${TARGET}]] and [[notes/Plan]]\n`);
    expect(roundTrip(block)).toStrictEqual(block);
  });

  it("spells a link to a place in its own item as it was written", () => {
    const block: LibraryBlock = {
      children: [
        { text: "see " },
        {
          children: [{ text: "" }],
          heading: "Rollback",
          itemId: null,
          title: "",
          type: "wikiLink",
        },
        { text: " and " },
        { blockRef: "r1", children: [{ text: "" }], itemId: null, title: "", type: "wikiEmbed" },
      ],
      id: "p1",
      type: "p",
    };
    expect(blockMarkdown(block)).toBe("see [[#Rollback]] and ![[#^r1]]\n");
    expect(roundTrip(block)).toStrictEqual(block);
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

  it("leaves a block's ref beside its text", () => {
    const block: LibraryBlock = {
      children: [{ children: [{ text: "line" }], type: "code_line" }],
      id: "c1",
      ref: "goal",
      type: "code_block",
    };
    const markdown = faithfulMarkdown(block, filesIn([block]));
    expect(markdown).toBe("```\nline\n```\n");
  });

  it("reads nothing back from markdown that holds two blocks", () => {
    expect(blockFromMarkdown("one\n\ntwo\n", "p1", new Map())).toBeNull();
  });
});
