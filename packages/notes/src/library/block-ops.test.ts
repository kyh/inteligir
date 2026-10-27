import { describe, expect, it } from "vitest";

import { blockHash } from "./block-hash";
import { applyOps, libraryOpSchema, mergeListField, orderedBlocks, rebaseOps } from "./block-ops";
import type { ItemState, LibraryOp } from "./block-ops";
import { ordBetween } from "./block-order";
import { BLOCK_MAX_BYTES, BLOCK_MAX_DEPTH } from "./library-nodes";
import type { LibraryNode } from "./library-nodes";
import {
  itemOf,
  landed,
  noteFields,
  paragraph,
  randomBlockOps,
  randomItem,
} from "../test-support/library-items";
import { mulberry32 } from "../test-support/seeded-random";

const three = (): ItemState =>
  itemOf([paragraph("one", "first"), paragraph("two", "second"), paragraph("three", "third")]);

const heldOf = (state: ItemState, id: string) => {
  const held = state.blocks.get(id);
  if (held === undefined) {
    throw new Error(`no block ${id}`);
  }
  return held;
};

describe("the per-block guard", () => {
  it("lands a put whose base is the block as it is, and refuses one whose base moved", () => {
    const item = three();
    const base = heldOf(item, "two").hash;
    const edited = landed(item, [{ baseHash: base, block: paragraph("two", "edited"), op: "put" }]);
    expect(heldOf(edited, "two").block).toEqual(paragraph("two", "edited"));
    const stale = applyOps(edited, [
      { baseHash: base, block: paragraph("two", "mine"), op: "put" },
    ]);
    expect(stale).toEqual({
      conflicts: [{ blockId: "two", current: heldOf(edited, "two"), kind: "block" }],
      kind: "conflict",
    });
  });

  it("reads a resend that meets its own result as satisfied, not as a conflict", () => {
    const item = three();
    const op: LibraryOp = {
      baseHash: heldOf(item, "one").hash,
      block: paragraph("one", "again"),
      op: "put",
    };
    const once = landed(item, [op]);
    const twice = applyOps(once, [op]);
    expect(twice.kind).toBe("applied");
    expect(twice.kind === "applied" && twice.touched.blocks.size).toBe(0);
  });

  it("treats an insert under a taken id as satisfied only when it is the same block", () => {
    const item = three();
    const op: LibraryOp = {
      block: paragraph("four", "fourth"),
      op: "insert",
      ord: ordBetween(heldOf(item, "three").ord, null),
      section: "note",
    };
    const once = landed(item, [op]);
    expect(applyOps(once, [op]).kind).toBe("applied");
    const other = applyOps(once, [{ ...op, block: paragraph("four", "another") }]);
    expect(other.kind).toBe("conflict");
  });

  it("drops a block only as it was read, and reads a drop of a missing block as done", () => {
    const item = three();
    const { hash } = heldOf(item, "one");
    expect(applyOps(item, [{ baseHash: "0".repeat(32), blockId: "one", op: "drop" }]).kind).toBe(
      "conflict",
    );
    const dropped = landed(item, [{ baseHash: hash, blockId: "one", op: "drop" }]);
    expect(dropped.blocks.has("one")).toBe(false);
    expect(applyOps(dropped, [{ baseHash: hash, blockId: "one", op: "drop" }]).kind).toBe(
      "applied",
    );
  });

  it("guards a move by the key it read, apart from the block's content", () => {
    const item = three();
    const one = heldOf(item, "one");
    const contentChanged = landed(item, [
      { baseHash: one.hash, block: paragraph("one", "edited"), op: "put" },
    ]);
    const last = ordBetween(heldOf(item, "three").ord, null);
    const moved = landed(contentChanged, [
      { baseOrd: one.ord, blockId: "one", op: "move", ord: last },
    ]);
    expect(orderedBlocks(moved.blocks).map(({ block }) => block.id)).toEqual([
      "two",
      "three",
      "one",
    ]);
    const second = applyOps(moved, [
      {
        baseOrd: one.ord,
        blockId: "one",
        op: "move",
        ord: ordBetween(null, heldOf(item, "two").ord),
      },
    ]);
    expect(second).toEqual({
      conflicts: [{ blockId: "one", currentOrd: last, kind: "order" }],
      kind: "conflict",
    });
  });

  it("lands nothing of a batch that meets a conflict, and names every op that met one", () => {
    const item = three();
    const outcome = applyOps(item, [
      { baseHash: heldOf(item, "one").hash, block: paragraph("one", "fine"), op: "put" },
      { baseHash: "0".repeat(32), block: paragraph("two", "stale"), op: "put" },
      { base: "Old", field: "title", op: "set", value: "New" },
    ]);
    expect(outcome.kind).toBe("conflict");
    expect(
      outcome.kind === "conflict" && outcome.conflicts.map((conflict) => conflict.kind),
    ).toEqual(["block", "field"]);
  });

  it("names the blocks and fields a batch changed", () => {
    const item = three();
    const outcome = applyOps(item, [
      { baseHash: heldOf(item, "one").hash, blockId: "one", op: "drop" },
      { base: "A note", field: "title", op: "set", value: "Renamed" },
      {
        block: paragraph("four", "new"),
        op: "insert",
        ord: ordBetween(null, null),
        section: "article",
      },
    ]);
    expect(outcome.kind === "applied" && outcome.touched).toEqual({
      blocks: new Set(["four"]),
      dropped: new Set(["one"]),
      fields: true,
    });
  });
});

describe("field patches", () => {
  it("lands a field over its base, reads its own value as done, and conflicts otherwise", () => {
    const item = three();
    const renamed = landed(item, [{ base: "A note", field: "title", op: "set", value: "B" }]);
    expect(renamed.fields.title).toBe("B");
    expect(
      applyOps(renamed, [{ base: "A note", field: "title", op: "set", value: "B" }]).kind,
    ).toBe("applied");
    expect(applyOps(renamed, [{ base: "A note", field: "title", op: "set", value: "C" }])).toEqual({
      conflicts: [{ current: "B", field: "title", kind: "field" }],
      kind: "conflict",
    });
  });

  it("merges two writers' tags as a set, case folded, so both land", () => {
    expect(mergeListField("tags", ["work", "Read"], ["work"], ["work", "idea"])).toEqual([
      "work",
      "Read",
      "idea",
    ]);
    expect(mergeListField("tags", ["work", "read"], ["work", "read"], ["read"])).toEqual(["read"]);
    expect(mergeListField("tags", ["Idea"], [], ["idea"])).toEqual(["Idea"]);
    const item = itemOf([], noteFields({ tags: ["later"] }));
    const tagged = landed(item, [{ base: [], op: "tags", value: ["mine"] }]);
    expect(tagged.fields.tags).toEqual(["later", "mine"]);
  });

  it("patches one property by its key, absent standing for no property", () => {
    const item = itemOf([], noteFields({ properties: { rating: 3 } }));
    const rated = landed(item, [{ base: 3, key: "rating", op: "property", value: 4 }]);
    expect(rated.fields.properties).toEqual({ rating: 4 });
    const added = landed(rated, [{ key: "due", op: "property", value: "2026-11-01" }]);
    expect(added.fields.properties).toEqual({ due: "2026-11-01", rating: 4 });
    const removed = landed(added, [{ base: 4, key: "rating", op: "property" }]);
    expect(removed.fields.properties).toEqual({ due: "2026-11-01" });
    expect(applyOps(removed, [{ base: 9, key: "due", op: "property", value: 1 }])).toEqual({
      conflicts: [{ current: "2026-11-01", key: "due", kind: "property" }],
      kind: "conflict",
    });
  });
});

describe("rebaseOps", () => {
  it("drops what already landed, keeps what still applies, and hands back what met a change", () => {
    const item = three();
    const queued: LibraryOp[] = [
      { baseHash: heldOf(item, "one").hash, block: paragraph("one", "mine"), op: "put" },
      { baseHash: heldOf(item, "two").hash, block: paragraph("two", "mine too"), op: "put" },
      { base: [], op: "tags", value: ["queued"] },
    ];
    const theirs = landed(item, [
      { baseHash: heldOf(item, "two").hash, block: paragraph("two", "theirs"), op: "put" },
      { base: [], op: "tags", value: ["remote"] },
    ]);
    const rebase = rebaseOps(theirs, queued);
    expect(rebase.ops).toEqual([
      queued[0],
      { base: ["remote"], op: "tags", value: ["remote", "queued"] },
    ]);
    expect(rebase.conflicts).toEqual([
      {
        conflict: { blockId: "two", current: heldOf(theirs, "two"), kind: "block" },
        op: queued[1],
      },
    ]);
  });

  it("commutes for two writers over disjoint blocks, whichever lands first (seeded)", () => {
    const rand = mulberry32(0x0b_10_c5);
    for (let trial = 0; trial < 300; trial += 1) {
      const base = randomItem(rand, "x", 1 + Math.floor(rand() * 8));
      const ids = [...base.blocks.keys()];
      const split = Math.floor(rand() * (ids.length + 1));
      const left = randomBlockOps(rand, base, ids.slice(0, split), "a", 1 + Math.floor(rand() * 4));
      const right = randomBlockOps(rand, base, ids.slice(split), "b", 1 + Math.floor(rand() * 4));
      const leftOps: LibraryOp[] = [
        ...left.ops,
        { base: "A note", field: "title", op: "set", value: "L" },
      ];
      const rightOps: LibraryOp[] = [
        ...right.ops,
        { base: null, field: "pinnedAt", op: "set", value: 5 },
      ];
      const afterLeft = landed(base, leftOps);
      const afterRight = landed(base, rightOps);
      const rightOverLeft = rebaseOps(afterLeft, rightOps);
      const leftOverRight = rebaseOps(afterRight, leftOps);
      expect(rightOverLeft.conflicts).toEqual([]);
      expect(leftOverRight.conflicts).toEqual([]);
      expect(landed(afterLeft, rightOverLeft.ops)).toEqual(landed(afterRight, leftOverRight.ops));
    }
  });
});

// built bottom up, so a depth no recursion survives can still be made
const nested = (depth: number): LibraryNode => {
  let node: LibraryNode = { text: "deep" };
  for (let level = 1; level <= depth; level += 1) {
    node = { children: [node], id: `q${String(level)}`, type: "blockquote" };
  }
  return node;
};

describe("the op grammar", () => {
  it("parses a batch and holds each field's patch to that field's own type", () => {
    const block = paragraph("p1", "text");
    expect(
      libraryOpSchema.array().validate([
        { block, op: "insert", ord: "a0", section: "note" },
        { baseHash: blockHash(block), block, op: "put" },
        { base: null, field: "pinnedAt", op: "set", value: 1 },
      ]),
    ).toBe(true);
    expect(
      libraryOpSchema.validate({ base: null, field: "pinnedAt", op: "set", value: "soon" }),
    ).toBe(false);
    expect(libraryOpSchema.validate({ base: [], op: "tags", value: ["not a tag"] })).toBe(false);
    expect(libraryOpSchema.validate({ block, op: "insert", ord: "a00", section: "note" })).toBe(
      false,
    );
  });

  it("refuses a block nested past the limit before the recursive parse reads it", () => {
    const tooDeep = { children: [nested(BLOCK_MAX_DEPTH + 5)], id: "deep", type: "blockquote" };
    const parsed = libraryOpSchema.safeParse({
      block: tooDeep,
      op: "insert",
      ord: "a0",
      section: "note",
    });
    expect(parsed.success).toBe(false);
    expect(JSON.stringify(parsed.error?.issues)).toContain("nests deeper");
    const pathological = { children: [nested(20_000)], id: "deeper", type: "blockquote" };
    expect(
      libraryOpSchema.validate({ block: pathological, op: "insert", ord: "a0", section: "note" }),
    ).toBe(false);
  });

  it("refuses a block larger than a row may hold", () => {
    const big = paragraph("big", "x".repeat(BLOCK_MAX_BYTES));
    const parsed = libraryOpSchema.safeParse({
      block: big,
      op: "insert",
      ord: "a0",
      section: "note",
    });
    expect(JSON.stringify(parsed.error?.issues)).toContain("larger than");
  });
});
