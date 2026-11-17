import { describe, expect, it } from "vitest";
import { NodeApi } from "platejs";

import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibrarySection } from "@repo/contract/library/library-nodes";

import { mergeBlocks } from "@repo/editor/headless/body/merge-blocks";

const p = (id: string, text: string, section: LibrarySection = "note"): BodyBlock => ({
  block: { children: [{ text }], id, type: "p" },
  section,
});

const BASE = [p("one", "1"), p("two", "2"), p("three", "3")];

const merged = (base: BodyBlock[], mine: BodyBlock[], theirs: BodyBlock[]): string[] => {
  const merge = mergeBlocks(base, mine, theirs);
  if (merge.kind !== "merged") {
    throw new Error(`a conflict over ${merge.blockIds.join(", ")}`);
  }
  return merge.blocks.map(
    ({ block, section }) => `${block.id}:${NodeApi.string(block)}:${section}`,
  );
};

describe("a body merged by block", () => {
  it("keeps both sides' edits to different blocks", () => {
    expect(
      merged(
        BASE,
        [p("one", "1 mine"), p("two", "2"), p("three", "3")],
        [p("one", "1"), p("two", "2"), p("three", "3 theirs")],
      ),
    ).toStrictEqual(["one:1 mine:note", "two:2:note", "three:3 theirs:note"]);
  });

  it("takes either side's block when both changed it alike", () => {
    const both = [p("one", "1"), p("two", "two"), p("three", "3")];
    expect(merged(BASE, both, both)).toStrictEqual(["one:1:note", "two:two:note", "three:3:note"]);
  });

  it("refuses a block both sides changed apart, naming each such block and landing nothing", () => {
    expect(
      mergeBlocks(
        BASE,
        [p("one", "uno"), p("two", "dos"), p("three", "3")],
        [p("one", "un"), p("two", "deux"), p("three", "trois")],
      ),
    ).toStrictEqual({ blockIds: ["one", "two"], kind: "conflict" });
  });

  it("counts a block moved to the other section as changed", () => {
    expect(
      mergeBlocks(
        BASE,
        [p("one", "1"), p("two", "2", "article"), p("three", "3")],
        [p("one", "1"), p("two", "2 theirs"), p("three", "3")],
      ),
    ).toStrictEqual({ blockIds: ["two"], kind: "conflict" });
    expect(
      merged(BASE, [p("one", "1", "article"), p("two", "2"), p("three", "3")], BASE),
    ).toStrictEqual(["one:1:article", "two:2:note", "three:3:note"]);
  });

  it("drops a block one side dropped and the other left, and keeps one the other edited", () => {
    expect(
      merged(
        BASE,
        [p("one", "1"), p("three", "3")],
        [p("one", "1"), p("two", "2"), p("three", "3")],
      ),
    ).toStrictEqual(["one:1:note", "three:3:note"]);
    expect(
      merged(
        BASE,
        [p("one", "1"), p("three", "3")],
        [p("one", "1"), p("two", "2 theirs"), p("three", "3")],
      ),
    ).toStrictEqual(["one:1:note", "two:2 theirs:note", "three:3:note"]);
    expect(
      merged(
        BASE,
        [p("one", "1"), p("two", "2 mine"), p("three", "3")],
        [p("one", "1"), p("three", "3")],
      ),
    ).toStrictEqual(["one:1:note", "two:2 mine:note", "three:3:note"]);
    expect(merged(BASE, [p("one", "1")], [p("one", "1"), p("three", "3")])).toStrictEqual([
      "one:1:note",
    ]);
  });

  it("places a block one side added after the block before it there, or at the top", () => {
    expect(
      merged(
        BASE,
        [p("top", "0"), p("one", "1"), p("new", "1.5"), p("two", "2"), p("three", "3")],
        [p("one", "1"), p("two", "2"), p("three", "3"), p("end", "4")],
      ),
    ).toStrictEqual([
      "top:0:note",
      "one:1:note",
      "new:1.5:note",
      "two:2:note",
      "three:3:note",
      "end:4:note",
    ]);
  });

  it("places an added block after the nearest block before it that the merge keeps", () => {
    expect(
      merged(
        BASE,
        [p("one", "1"), p("two", "2"), p("new", "2.5"), p("next", "2.6"), p("three", "3")],
        [p("one", "1"), p("three", "3")],
      ),
    ).toStrictEqual(["one:1:note", "new:2.5:note", "next:2.6:note", "three:3:note"]);
  });

  it("keeps the side that moved blocks in its order, and theirs when both did", () => {
    const mineMoved = [p("three", "3"), p("one", "1"), p("two", "2")];
    const theirsEdited = [p("one", "1"), p("two", "2 theirs"), p("three", "3")];
    expect(merged(BASE, mineMoved, theirsEdited)).toStrictEqual([
      "three:3:note",
      "one:1:note",
      "two:2 theirs:note",
    ]);
    expect(merged(BASE, theirsEdited, mineMoved)).toStrictEqual([
      "three:3:note",
      "one:1:note",
      "two:2 theirs:note",
    ]);
    expect(merged(BASE, mineMoved, [p("two", "2"), p("one", "1"), p("three", "3")])).toStrictEqual([
      "two:2:note",
      "one:1:note",
      "three:3:note",
    ]);
  });

  it("answers the other side's body when one side changed nothing", () => {
    const theirs = [p("three", "3"), p("one", "uno"), p("four", "4")];
    expect(merged(BASE, BASE, theirs)).toStrictEqual([
      "three:3:note",
      "one:uno:note",
      "four:4:note",
    ]);
    expect(merged(BASE, theirs, BASE)).toStrictEqual([
      "three:3:note",
      "one:uno:note",
      "four:4:note",
    ]);
  });

  it("holds one block both sides added under one id, or refuses it when they differ", () => {
    expect(merged([], [p("new", "n")], [p("new", "n")])).toStrictEqual(["new:n:note"]);
    expect(mergeBlocks([], [p("new", "mine")], [p("new", "theirs")])).toStrictEqual({
      blockIds: ["new"],
      kind: "conflict",
    });
  });
});
