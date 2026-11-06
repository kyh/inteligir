import { blockHash } from "@repo/notes/library/block-hash";
import type { StoredBlock } from "@repo/notes/library/block-ops";
import type { LibraryBlock } from "@repo/notes/library/library-nodes";
import { assert, describe, expect, it } from "vitest";

import type { WriteOp } from "./outbox-ops";
import { settleFolders, settleWrite } from "./outbox-settle";
import type { BlockMerge } from "./replica-ports";
import { idSource, keepBoth, paragraph } from "./test-support/replica-harness";

const ITEM = "01900000-0000-7000-8000-00000000000a";
const OTHER_ITEM = "01900000-0000-7000-8000-00000000000b";
const ports = { merge: keepBoth, newId: idSource(9) };

// a merge that keeps this device's block whole over the other's, and says it overlapped
const keepMine: BlockMerge = async ({ mine }) =>
  await Promise.resolve({ block: mine, overlapped: true });

const held = (text: string, ord = "a0"): StoredBlock => {
  const block = paragraph("p1", text);
  return { block, hash: blockHash(block), ord, section: "note" };
};

// a write of one paragraph from `base` to `mine`
const putWrite = (base: StoredBlock, mine: string): WriteOp => ({
  annotations: [],
  bases: { p1: base },
  itemId: ITEM,
  kind: "write",
  ops: [{ baseHash: base.hash, block: paragraph("p1", mine), op: "put" }],
  staged: [],
});

describe("a write the cell answered CONFLICT", () => {
  it("merges a put over the block another device wrote, and names that block its new base", async () => {
    const base = held("draft");
    const theirs = held("their draft");
    const settled = await settleWrite(
      putWrite(base, "my draft"),
      [{ blockId: "p1", current: theirs, itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(settled).toStrictEqual({
      kind: "resend",
      op: {
        ...putWrite(theirs, "their draft / my draft"),
        bases: { p1: theirs },
      },
      overlapped: false,
    });
  });

  it("says a merge kept this device's lines over the other device's change to them", async () => {
    const settled = await settleWrite(
      putWrite(held("draft"), "my draft"),
      [{ blockId: "p1", current: held("their draft"), itemId: ITEM, kind: "block" }],
      { merge: keepMine, newId: idSource(9) },
    );
    expect(settled).toMatchObject({ kind: "resend", overlapped: true });
  });

  it("counts a put whose block already holds what it wrote as landed", async () => {
    const base = held("draft");
    const settled = await settleWrite(
      putWrite(base, "mine"),
      [{ blockId: "p1", current: held("mine"), itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(settled).toStrictEqual({ kind: "satisfied" });
  });

  it("stands a put whose block another device dropped again where its base stood", async () => {
    const base = held("draft", "a5");
    const settled = await settleWrite(
      putWrite(base, "kept"),
      [{ blockId: "p1", current: null, itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(settled.kind === "resend" ? settled.op.ops : []).toStrictEqual([
      { block: paragraph("p1", "kept"), op: "insert", ord: "a5", section: "note" },
    ]);
  });

  it("keeps the move of a block another device changed, from the place that block holds now", async () => {
    const base = held("draft");
    const write: WriteOp = {
      ...putWrite(base, "my draft"),
      ops: [
        { baseHash: base.hash, block: paragraph("p1", "my draft"), op: "put" },
        { baseOrd: "a0", blockId: "p1", op: "move", ord: "a2" },
      ],
    };
    const moved = await settleWrite(
      write,
      [{ blockId: "p1", current: held("their draft", "a1"), itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(moved.kind === "resend" ? moved.op.ops : []).toStrictEqual([
      {
        baseHash: held("their draft", "a1").hash,
        block: paragraph("p1", "their draft / my draft"),
        op: "put",
      },
      { baseOrd: "a1", blockId: "p1", op: "move", ord: "a2" },
    ]);
    const placed = await settleWrite(
      write,
      [{ blockId: "p1", current: held("their draft", "a2"), itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(placed.kind === "resend" ? placed.op.ops.map((op) => op.op) : []).toStrictEqual(["put"]);
    const dropped = await settleWrite(
      write,
      [{ blockId: "p1", current: null, itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(dropped.kind === "resend" ? dropped.op.ops : []).toStrictEqual([
      { block: paragraph("p1", "my draft"), op: "insert", ord: "a2", section: "note" },
    ]);
  });

  it("lets a drop of a block another device changed go", async () => {
    const base = held("draft");
    const write: WriteOp = {
      ...putWrite(base, "unused"),
      ops: [{ baseHash: base.hash, blockId: "p1", op: "drop" }],
    };
    const settled = await settleWrite(
      write,
      [{ blockId: "p1", current: held("theirs"), itemId: ITEM, kind: "block" }],
      ports,
    );
    expect(settled).toStrictEqual({ kind: "satisfied" });
  });

  it("adds a highlight whose id another item holds under an id of its own, its markers renamed", async () => {
    const marked: LibraryBlock = {
      children: [
        { children: [{ text: "" }], edge: "start", ids: "h1", type: "annotationMarker" },
        { text: "a passage" },
        { children: [{ text: "" }], edge: "end", ids: "h1", type: "annotationMarker" },
      ],
      id: "p1",
      type: "p",
    };
    const write: WriteOp = {
      annotations: [
        {
          createdAt: 1,
          id: "h1",
          occurrence: null,
          op: "add",
          parentId: null,
          quote: "a passage",
          text: "",
        },
      ],
      bases: {},
      itemId: ITEM,
      kind: "write",
      ops: [{ block: marked, op: "insert", ord: "a0", section: "note" }],
      staged: [],
    };
    const settled = await settleWrite(
      write,
      [
        {
          current: {
            createdAt: 1,
            deletedAt: null,
            id: "h1",
            itemId: OTHER_ITEM,
            occurrence: null,
            parentId: null,
            quote: "elsewhere",
            seq: 3,
            source: "user",
            text: "",
            updatedAt: 1,
          },
          id: "h1",
          itemId: ITEM,
          kind: "annotation",
        },
      ],
      { merge: keepBoth, newId: () => "h2" },
    );
    assert(settled.kind === "resend", `the settle answered ${settled.kind}`);
    expect(settled.op.annotations.map((op) => op.id)).toStrictEqual(["h2"]);
    expect(JSON.stringify(settled.op.ops)).toContain('"ids":"h2"');
    expect(JSON.stringify(settled.op.ops)).not.toContain('"ids":"h1"');
  });
});

describe("a folder write the cell answered CONFLICT", () => {
  const FOLDER = "01900000-0000-7000-8000-0000000000f1";
  const folder = (name: string) => ({
    deletedAt: null,
    id: FOLDER,
    name,
    parentId: null,
    seq: 4,
    sort: "a0",
  });

  it("renames over the name another device gave it, and lets a rename to it go", async () => {
    const rename = { base: "Reading", id: FOLDER, name: "To read", op: "rename" as const };
    expect(
      settleFolders([rename], [{ current: folder("Later"), id: FOLDER, kind: "folder" }]),
    ).toStrictEqual({ kind: "resend", op: [{ ...rename, base: "Later" }] });
    expect(
      settleFolders([rename], [{ current: folder("To read"), id: FOLDER, kind: "folder" }]),
    ).toStrictEqual({ kind: "satisfied" });
  });
});
