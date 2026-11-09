import { describe, expect, it } from "vitest";
import type { TElement } from "platejs";

import { blockHash } from "@repo/contract/library/block-hash";
import { applyOps, orderedBlocks } from "@repo/contract/library/block-ops";
import type { ItemState, StoredBlock } from "@repo/contract/library/block-ops";
import { ordsBetween } from "@repo/contract/library/block-order";
import type {
  LibraryBlock,
  LibraryNode,
  LibrarySection,
} from "@repo/contract/library/library-nodes";
import { landed, noteFields, paragraph } from "@repo/contract/test-support/library-items";
import { mulberry32 } from "@repo/contract/test-support/seeded-random";

import { diffValue, readElement } from "./item-diff";
import { elementOf } from "./item-session";

const textOf = (block: LibraryBlock): string =>
  block.children.map((child) => ("text" in child ? child.text : "")).join("");

// an item of `notes` paragraphs, then `articles` more in its article
const itemOf = (notes: number, articles: number): ItemState => {
  const blocks = new Map<string, StoredBlock>();
  const place = (count: number, section: LibrarySection, prefix: string): void => {
    for (const [index, ord] of ordsBetween(null, null, count).entries()) {
      const block = paragraph(`${prefix}${String(index)}`, `${prefix} ${String(index)}`);
      blocks.set(block.id, { block, hash: blockHash(block), ord, section });
    }
  };
  place(notes, "note", "n");
  place(articles, "article", "a");
  return { blocks, fields: noteFields() };
};

const valueOf = (state: ItemState): TElement[] =>
  orderedBlocks(state.blocks).map((stored) => elementOf(stored.block));

const blocksOf = (value: readonly TElement[]): LibraryBlock[] =>
  value.flatMap((element) => {
    const read = readElement(element);
    return read.kind === "block" ? [read.block] : [];
  });

const writtenAs = (state: ItemState, value: readonly TElement[]): ItemState =>
  landed(state, diffValue(state.blocks, value).ops);

const idsOf = (state: ItemState): string[] =>
  orderedBlocks(state.blocks).map((stored) => stored.block.id);

const SEEDS = Array.from({ length: 40 }, (_, index) => index + 1);

// one random edit a person makes: a block's text changed, a block gone, one typed anywhere, one
// dragged elsewhere
const editOnce = (rand: () => number, value: TElement[], fresh: string): TElement[] => {
  const at = Math.floor(rand() * Math.max(1, value.length));
  const roll = rand();
  const element = value[at];
  if (roll < 0.3 && element !== undefined) {
    const read = readElement(element);
    return read.kind === "block"
      ? value.with(at, elementOf(paragraph(read.block.id, `${textOf(read.block)}!`)))
      : value;
  }
  if (roll < 0.5 && element !== undefined) {
    return value.toSpliced(at, 1);
  }
  if (roll < 0.8 || element === undefined) {
    return value.toSpliced(at, 0, elementOf(paragraph(fresh, "typed")));
  }
  const rest = value.toSpliced(at, 1);
  return rest.toSpliced(Math.floor(rand() * (rest.length + 1)), 0, element);
};

describe("an item's value as the ops it writes", () => {
  it("writes nothing for a value that holds the item's blocks", () => {
    const item = itemOf(3, 2);
    expect(diffValue(item.blocks, valueOf(item)).ops).toStrictEqual([]);
  });

  it("decides a block by its hash, so another object holding the same block writes nothing", () => {
    const item = itemOf(2, 0);
    const value = valueOf(item).map((element) => ({ ...element }));
    expect(diffValue(item.blocks, value).ops).toStrictEqual([]);
  });

  it("reads a block in its one spelling, so the empty texts Slate keeps around a link write nothing", () => {
    const link: LibraryNode = {
      children: [{ text: "" }],
      key: "item-2",
      type: "mention",
      value: "Plan",
    };
    const stored: LibraryBlock = { children: [{ text: "see " }, link], id: "p1", type: "p" };
    const item = {
      blocks: new Map([
        ["p1", { block: stored, hash: blockHash(stored), ord: "a0", section: "note" as const }],
      ]),
      fields: noteFields(),
    };
    const slate: TElement = {
      children: [{ text: "see " }, link, { text: "" }],
      id: "p1",
      type: "p",
    };
    expect(diffValue(item.blocks, [slate]).ops).toStrictEqual([]);
  });

  it("writes an id Plate minted again as a drop and an insert where the block stood", () => {
    const item = itemOf(3, 0);
    const value = valueOf(item).with(1, elementOf(paragraph("fresh", "n 1")));
    expect(
      diffValue(item.blocks, value)
        .ops.map((op) => op.op)
        .toSorted(),
    ).toStrictEqual(["drop", "insert"]);
    expect(idsOf(writtenAs(item, value))).toStrictEqual(["n0", "fresh", "n2"]);
  });

  it("holds back an element no block stores, and leaves its block as it was", () => {
    const item = itemOf(2, 0);
    const value = valueOf(item).with(0, { children: [{ text: "x" }], id: "n0", type: "nope" });
    const diff = diffValue(item.blocks, value);
    expect(diff.ops).toStrictEqual([]);
    expect(diff.heldBack).toStrictEqual(["n0"]);
  });

  it("stores a page link marked as the text around it is", () => {
    const item = itemOf(1, 0);
    const link = {
      children: [{ bold: true, text: "" }],
      key: "item-2",
      type: "mention",
      value: "",
    };
    const value = [{ children: [{ text: "see " }, link, { text: "" }], id: "n0", type: "p" }];
    const diff = diffValue(item.blocks, value);
    expect(diff.heldBack).toStrictEqual([]);
    expect(diff.ops).toMatchObject([{ op: "put" }]);
  });

  it("reads a block around a picker still open in it, whose query nobody has written yet", () => {
    const item = itemOf(1, 0);
    const picking: TElement = {
      children: [
        { text: "n 0 [" },
        { children: [{ text: "" }], type: "mention_input" },
        { text: "" },
      ],
      id: "n0",
      type: "p",
    };
    const diff = diffValue(item.blocks, [picking]);
    expect(diff.heldBack).toStrictEqual([]);
    expect(diff.ops).toMatchObject([{ block: paragraph("n0", "n 0 ["), op: "put" }]);
  });

  it("files a block typed below the article in the note, so a read never takes it", () => {
    const item = itemOf(1, 2);
    const value = [...valueOf(item), elementOf(paragraph("late", "late"))];
    const written = writtenAs(item, value);
    expect(written.blocks.get("late")?.section).toBe("note");
    expect(idsOf(written)).toStrictEqual(["n0", "late", "a0", "a1"]);
    expect(diffValue(written.blocks, value).ops).toStrictEqual([]);
    const read = landed(
      written,
      [...written.blocks.values()].flatMap((held) =>
        held.section === "article"
          ? [{ baseHash: held.hash, blockId: held.block.id, op: "drop" as const }]
          : [],
      ),
    );
    expect(idsOf(read)).toStrictEqual(["n0", "late"]);
  });

  it("files a block typed inside the article in the note", () => {
    const item = itemOf(0, 2);
    const value = valueOf(item).toSpliced(1, 0, elementOf(paragraph("mid", "mid")));
    expect(writtenAs(item, value).blocks.get("mid")?.section).toBe("note");
  });

  it("keeps a block's section wherever it is dragged, writing it as no new block", () => {
    const item = itemOf(2, 2);
    const [n0, n1, a0, a1] = valueOf(item);
    if (n0 === undefined || n1 === undefined || a0 === undefined || a1 === undefined) {
      throw new Error("the item holds four blocks");
    }
    const { ops } = diffValue(item.blocks, [a1, n1, a0, n0]);
    expect(ops.map((op) => op.op).filter((op) => op !== "move")).toStrictEqual([]);
    const written = writtenAs(item, [a1, n1, a0, n0]);
    expect(idsOf(written)).toStrictEqual(["n1", "n0", "a1", "a0"]);
  });

  it("moves a dragged block alone, keeping every other block's key", () => {
    const item = itemOf(4, 0);
    const value = valueOf(item);
    const [first] = value;
    const dragged = first === undefined ? value : [...value.slice(1), first];
    const { ops } = diffValue(item.blocks, dragged);
    expect(ops).toMatchObject([{ blockId: "n0", op: "move" }]);
  });

  it.each(SEEDS)("lands any edit as the value it made, section by section (seed %i)", (seed) => {
    const rand = mulberry32(seed);
    const item = itemOf(1 + Math.floor(rand() * 6), Math.floor(rand() * 4));
    let value = valueOf(item);
    const edits = 1 + Math.floor(rand() * 8);
    for (let step = 0; step < edits; step += 1) {
      value = editOnce(rand, value, `new${String(step)}`);
    }
    const after = writtenAs(item, value);
    const inSection = (section: LibrarySection): LibraryBlock[] =>
      blocksOf(value).filter((block) => after.blocks.get(block.id)?.section === section);
    expect(orderedBlocks(after.blocks).map((stored) => stored.block)).toStrictEqual([
      ...inSection("note"),
      ...inSection("article"),
    ]);
    expect(diffValue(after.blocks, value).ops).toStrictEqual([]);
  });

  it.each(SEEDS)(
    "lands two sessions' edits to different blocks with no conflict (seed %i)",
    (seed) => {
      const rand = mulberry32(seed);
      const item = itemOf(2 + Math.floor(rand() * 6), Math.floor(rand() * 4));
      const writer = new Map(idsOf(item).map((id) => [id, rand() < 0.5 ? "mac" : "phone"]));
      const expected = new Map(
        orderedBlocks(item.blocks).map((stored) => [stored.block.id, textOf(stored.block)]),
      );
      const sessionValue = (who: string): TElement[] =>
        valueOf(item).flatMap((element) => {
          const read = readElement(element);
          if (read.kind !== "block" || writer.get(read.block.id) !== who) {
            return [element];
          }
          const { id } = read.block;
          const roll = rand();
          const kept: TElement[] = [];
          if (roll < 0.25) {
            expected.delete(id);
          } else if (roll < 0.6) {
            expected.set(id, `${who} wrote ${id}`);
            kept.push(elementOf(paragraph(id, `${who} wrote ${id}`)));
          } else {
            kept.push(element);
          }
          if (rand() < 0.3) {
            expected.set(`${who}-${id}`, "typed");
            kept.push(elementOf(paragraph(`${who}-${id}`, "typed")));
          }
          return kept;
        });
      const mac = diffValue(item.blocks, sessionValue("mac"));
      const phone = diffValue(item.blocks, sessionValue("phone"));
      const first = applyOps(item, mac.ops);
      if (first.kind !== "applied") {
        throw new Error(`the Mac's ops did not land: ${first.kind}`);
      }
      const second = applyOps(first.state, phone.ops);
      expect(second.kind).toBe("applied");
      if (second.kind !== "applied") {
        return;
      }
      const texts = new Map(
        orderedBlocks(second.state.blocks).map((stored) => [stored.block.id, textOf(stored.block)]),
      );
      expect(texts).toStrictEqual(expected);
    },
  );
});
