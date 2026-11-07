import { blockHash } from "@repo/notes/library/block-hash";
import { applyOps, orderedBlocks } from "@repo/notes/library/block-ops";
import type { ItemState, LibraryOp, StoredBlock } from "@repo/notes/library/block-ops";
import { ordBetween } from "@repo/notes/library/block-order";
import type { LibraryItemFields } from "@repo/notes/library/library-item";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { mulberry32, pick } from "@repo/notes/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import {
  coalesceWrites,
  compactAnnotations,
  compactOps,
  repointedOp,
  shasNamed,
} from "./outbox-ops";
import type { WriteOp } from "./outbox-ops";
import { paragraph } from "./test-support/replica-harness";

const FIELDS: LibraryItemFields = {
  aliases: [],
  author: null,
  coverSha: null,
  deletedAt: null,
  description: null,
  fetchError: null,
  fetchState: "none",
  fetchedAt: null,
  folderId: null,
  kind: "note",
  lang: null,
  originalName: null,
  originalSha: null,
  pinnedAt: null,
  properties: {},
  published: null,
  savedAt: 1_700_000_000_000,
  site: null,
  tags: [],
  title: "Plans",
  url: null,
};

const held = (id: string, text: string, ord: string): StoredBlock => {
  const block = paragraph(id, text);
  return { block, hash: blockHash(block), ord, section: "note" };
};

const itemOf = (...blocks: StoredBlock[]): ItemState => ({
  blocks: new Map(blocks.map((block) => [block.block.id, block])),
  fields: FIELDS,
});

const landed = (state: ItemState, ops: readonly LibraryOp[]): ItemState => {
  const outcome = applyOps(state, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`the ops did not land: ${JSON.stringify(outcome)}`);
  }
  return outcome.state;
};

// an item's state as plain data, its blocks in reading order
const readingOf = (state: ItemState) => ({
  blocks: orderedBlocks(state.blocks).map(({ block, hash, ord, section }) => ({
    block,
    hash,
    ord,
    section,
  })),
  fields: state.fields,
});

const put = (state: ItemState, id: string, text: string): LibraryOp => ({
  baseHash: state.blocks.get(id)?.hash ?? "",
  block: paragraph(id, text),
  op: "put",
});

describe("an outbox row's compaction", () => {
  it("makes three puts of one block one put on the first base", () => {
    let state = itemOf(held("p1", "a", "a0"));
    const first = state.blocks.get("p1")?.hash;
    const ops: LibraryOp[] = [];
    for (const text of ["ab", "abc", "abcd"]) {
      const op = put(state, "p1", text);
      ops.push(op);
      state = landed(state, [op]);
    }
    expect(compactOps(ops)).toStrictEqual([
      { baseHash: first, block: paragraph("p1", "abcd"), op: "put" },
    ]);
  });

  it("folds a put into the insert that made its block, and an insert then a drop into nothing", () => {
    const empty = itemOf();
    const insert: LibraryOp = {
      block: paragraph("n1", "new"),
      op: "insert",
      ord: "a0",
      section: "note",
    };
    const afterInsert = landed(empty, [insert]);
    const edit = put(afterInsert, "n1", "newer");
    expect(compactOps([insert, edit])).toStrictEqual([
      { ...insert, block: paragraph("n1", "newer") },
    ]);
    const drop: LibraryOp = {
      baseHash: blockHash(paragraph("n1", "newer")),
      blockId: "n1",
      op: "drop",
    };
    expect(compactOps([insert, edit, drop])).toStrictEqual([]);
  });

  it("keeps a run whose bases do not follow each other as it was written", () => {
    const state = itemOf(held("p1", "a", "a0"));
    const twice = [put(state, "p1", "b"), put(state, "p1", "c")];
    expect(compactOps(twice)).toStrictEqual(twice);
  });

  it("drops a field run that ends where it began, and spans one that does not", () => {
    const there: LibraryOp = { base: "Plans", field: "title", op: "set", value: "Ideas" };
    const back: LibraryOp = { base: "Ideas", field: "title", op: "set", value: "Plans" };
    const on: LibraryOp = { base: "Ideas", field: "title", op: "set", value: "Notes" };
    expect(compactOps([there, back])).toStrictEqual([]);
    expect(compactOps([there, on])).toStrictEqual([
      { base: "Plans", field: "title", op: "set", value: "Notes" },
    ]);
  });

  it("lands a compacted batch as the batch landed op by op, over seeded runs", () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const rand = mulberry32(seed);
      const start = itemOf(
        held("p1", "one", "a0"),
        held("p2", "two", "a1"),
        held("p3", "three", "a2"),
      );
      let state = start;
      const ops: LibraryOp[] = [];
      let made = 0;
      const steps = 1 + Math.floor(rand() * 8);
      for (let step = 0; step < steps; step += 1) {
        const ids = [...state.blocks.keys()];
        const last = orderedBlocks(state.blocks).at(-1)?.ord ?? null;
        const kind = pick(rand, ["put", "put", "drop", "insert", "move", "title", "tags"] as const);
        let op: LibraryOp;
        if (kind === "insert" || ids.length === 0) {
          made += 1;
          op = {
            block: paragraph(`n${String(made)}`, `new ${String(step)}`),
            op: "insert",
            ord: ordBetween(last, null),
            section: "note",
          };
        } else if (kind === "put") {
          op = put(state, pick(rand, ids), `text ${String(seed)}.${String(step)}`);
        } else if (kind === "drop") {
          const id = pick(rand, ids);
          op = { baseHash: state.blocks.get(id)?.hash ?? "", blockId: id, op: "drop" };
        } else if (kind === "move") {
          const id = pick(rand, ids);
          op = {
            baseOrd: state.blocks.get(id)?.ord ?? "",
            blockId: id,
            op: "move",
            ord: ordBetween(last, null),
          };
        } else if (kind === "title") {
          op = {
            base: state.fields.title,
            field: "title",
            op: "set",
            value: pick(rand, ["Plans", "Ideas", "Notes"]),
          };
        } else {
          op = { base: state.fields.tags, op: "tags", value: pick(rand, [[], ["a"], ["a", "b"]]) };
        }
        const outcome = applyOps(state, [op]);
        if (outcome.kind !== "applied") {
          continue;
        }
        ops.push(op);
        ({ state } = outcome);
      }
      expect(readingOf(landed(start, compactOps(ops))), `seed ${String(seed)}`).toStrictEqual(
        readingOf(state),
      );
    }
  });

  it("carries a highlight's last note into its add, and lets an add then a removal go", () => {
    const add = {
      createdAt: 1,
      id: "h1",
      occurrence: null,
      op: "add" as const,
      parentId: null,
      quote: "a passage",
      text: "",
    };
    const note = { base: "", id: "h1", op: "note" as const, text: "why it matters" };
    expect(compactAnnotations([add, note])).toStrictEqual([{ ...add, text: "why it matters" }]);
    expect(
      compactAnnotations([add, note, { base: "why it matters", id: "h1", op: "remove" }]),
    ).toStrictEqual([]);
  });

  it("joins a later write to the queued one on the first bases, staging each file once", () => {
    const state = itemOf(held("p1", "a", "a0"));
    const first: WriteOp = {
      annotations: [],
      bases: { p1: held("p1", "a", "a0") },
      itemId: "01900000-0000-7000-8000-000000000001",
      kind: "write",
      ops: [put(state, "p1", "b")],
      staged: [{ mime: "image/png", sha: "a".repeat(64) }],
    };
    const second: WriteOp = {
      ...first,
      bases: { p1: held("p1", "b", "a0") },
      ops: [put(landed(state, first.ops), "p1", "c")],
      staged: [
        { mime: "image/png", sha: "a".repeat(64) },
        { mime: "image/png", sha: "b".repeat(64) },
      ],
    };
    const joined = coalesceWrites(first, second);
    expect(joined.bases).toStrictEqual(first.bases);
    expect(joined.ops).toStrictEqual([
      { baseHash: blockHash(paragraph("p1", "a")), block: paragraph("p1", "c"), op: "put" },
    ]);
    expect(joined.staged.map((file) => file.sha)).toStrictEqual(["a".repeat(64), "b".repeat(64)]);
  });
});

// a picture block naming its file by sha
const picture = (id: string, sha: string): LibraryBlock => ({
  children: [{ text: "" }],
  id,
  sha,
  type: "img",
});

describe(shasNamed, () => {
  it("names the files a write's puts and inserts embed, never a drop's", () => {
    const op: WriteOp = {
      annotations: [],
      bases: {},
      itemId: "item-1",
      kind: "write",
      ops: [
        { block: picture("i1", "a".repeat(64)), op: "insert", ord: "a0", section: "note" },
        { baseHash: "0".repeat(32), block: picture("i2", "b".repeat(64)), op: "put" },
        { baseHash: "0".repeat(32), blockId: "i3", op: "drop" },
      ],
      staged: [],
    };
    expect([...shasNamed(op)]).toStrictEqual(["a".repeat(64), "b".repeat(64)]);
  });

  it("names the files a new note's blocks embed, and none for a kept file's own row", () => {
    expect([
      ...shasNamed({
        input: {
          blocks: [{ block: picture("i1", "c".repeat(64)), ord: "a0", section: "note" }],
          folderId: null,
          id: "0190f0b0-0000-7000-8000-000000000000",
          savedAt: 1,
          tags: [],
          title: "Pictures",
        },
        kind: "create",
        staged: [],
      }),
    ]).toStrictEqual(["c".repeat(64)]);
    expect(
      shasNamed({ kind: "keep", staged: [{ mime: "image/png", sha: "c".repeat(64) }] }).size,
    ).toBe(0);
  });
});

describe(repointedOp, () => {
  it("takes a write on the folded make to the item it landed on", () => {
    const write: WriteOp = {
      annotations: [],
      bases: {},
      itemId: "card",
      kind: "write",
      ops: [],
      staged: [],
    };
    expect(repointedOp(write, "card", "holder")).toStrictEqual({ ...write, itemId: "holder" });
  });

  it.each(["delete", "restore"] as const)(
    "lets the folded make go from a %s, asking nothing of the item it landed on",
    (kind) => {
      expect(repointedOp({ ids: ["card", "other"], kind }, "card", "holder")).toStrictEqual({
        ids: ["other"],
        kind,
      });
      expect(repointedOp({ ids: ["card"], kind }, "card", "holder")).toBeNull();
    },
  );
});
