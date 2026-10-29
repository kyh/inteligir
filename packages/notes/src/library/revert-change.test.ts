import { describe, expect, it } from "vitest";

import type { AnnotationStore } from "../annotations/store-schema";
import { revertEdit } from "../text/revert-edit";
import { orderedBlocks } from "./block-ops";
import type { ItemState, LibraryOp } from "./block-ops";
import { ITEM_FIELD_CAPS } from "./library-item";
import type { LibraryBlock } from "./library-nodes";
import { revertChangeSets, revertItemChange, snapshotOf } from "./revert-change";
import type { ItemChange, ItemRevert } from "./revert-change";
import {
  itemOf,
  landed,
  noteFields,
  paragraph,
  randomBlockOps,
  randomItem,
  renderLines,
} from "../test-support/library-items";
import { mulberry32, pick } from "../test-support/seeded-random";

const AT = 1_800_000_000_000;

const changeOf = (
  before: ItemState | null,
  after: ItemState,
  annotations: { before?: AnnotationStore; after?: AnnotationStore } = {},
): ItemChange => ({
  after: snapshotOf({ annotations: annotations.after ?? {}, state: after }),
  before:
    before === null ? null : snapshotOf({ annotations: annotations.before ?? {}, state: before }),
});

const versionsOf = (...states: readonly ItemState[]) => {
  const versions = new Map<string, LibraryBlock>();
  for (const state of states) {
    for (const held of state.blocks.values()) {
      versions.set(held.hash, held.block);
    }
  }
  return (hash: string) => versions.get(hash);
};

const revert = (
  change: ItemChange,
  now: ItemState | null,
  versions: (hash: string) => LibraryBlock | undefined,
  annotations: AnnotationStore = {},
): ItemRevert =>
  revertItemChange({
    at: AT,
    blockAt: versions,
    change,
    now: now === null ? null : { annotations, state: now },
  });

const stateOf = (verdict: ItemRevert): ItemState => {
  if (verdict.kind !== "revert") {
    throw new Error(`expected a revert, got ${verdict.kind}`);
  }
  return verdict.state;
};

const heldHash = (state: ItemState, id: string): string => {
  const held = state.blocks.get(id);
  if (held === undefined) {
    throw new Error(`no block ${id}`);
  }
  return held.hash;
};

describe("revertItemChange", () => {
  it("takes a block edit back and keeps a later edit to another block", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two")]);
    const y = landed(x, [{ baseHash: heldHash(x, "a"), block: paragraph("a", "ONE"), op: "put" }]);
    const now = landed(y, [
      { baseHash: heldHash(y, "b"), block: paragraph("b", "TWO"), op: "put" },
    ]);
    const reverted = stateOf(revert(changeOf(x, y), now, versionsOf(x, y)));
    expect(renderLines(reverted)).toBe("a:one\nb:TWO");
  });

  it("keeps the item whole when a block the set changed was changed again since", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two")]);
    const y = landed(x, [{ baseHash: heldHash(x, "a"), block: paragraph("a", "ONE"), op: "put" }]);
    const now = landed(y, [
      { baseHash: heldHash(y, "a"), block: paragraph("a", "uno"), op: "put" },
    ]);
    expect(revert(changeOf(x, y), now, versionsOf(x, y))).toEqual({
      kind: "keep",
      reason: "edited-since",
    });
  });

  it("brings a deleted block back on its own key, between the blocks around it", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two"), paragraph("c", "three")]);
    const y = landed(x, [{ baseHash: heldHash(x, "b"), blockId: "b", op: "drop" }]);
    const reverted = stateOf(revert(changeOf(x, y), y, versionsOf(x, y)));
    expect(reverted).toEqual(x);
  });

  it("drops a block the set inserted, and keeps one someone edited since", () => {
    const x = itemOf([paragraph("a", "one")]);
    const y = landed(x, [
      { block: paragraph("n", "new"), op: "insert", ord: "a5", section: "note" },
    ]);
    expect(stateOf(revert(changeOf(x, y), y, versionsOf(x, y)))).toEqual(x);
    const edited = landed(y, [
      { baseHash: heldHash(y, "n"), block: paragraph("n", "newer"), op: "put" },
    ]);
    expect(revert(changeOf(x, y), edited, versionsOf(x, y)).kind).toBe("keep");
  });

  it("reverts fields one by one, tags as a set, and answers an overlap", () => {
    const x = itemOf([], noteFields({ tags: ["keep"], title: "Old" }));
    const y = landed(x, [
      { base: "Old", field: "title", op: "set", value: "New" },
      { base: ["keep"], op: "tags", value: ["keep", "added"] },
      { key: "rating", op: "property", value: 5 },
    ]);
    const now = landed(y, [
      { base: ["keep", "added"], op: "tags", value: ["keep", "added", "later"] },
    ]);
    const reverted = stateOf(revert(changeOf(x, y), now, versionsOf(x, y)));
    expect(reverted.fields.title).toBe("Old");
    expect(reverted.fields.tags).toEqual(["keep", "later"]);
    expect(reverted.fields.properties).toEqual({});
    const retitled = landed(y, [{ base: "New", field: "title", op: "set", value: "Newer" }]);
    expect(revert(changeOf(x, y), retitled, versionsOf(x, y)).kind).toBe("keep");
  });

  it("keeps the item whole when what the set took out no longer fits", () => {
    const x = itemOf([], noteFields({ tags: ["keep", "gone"] }));
    const y = landed(x, [{ base: ["keep", "gone"], op: "tags", value: ["keep"] }]);
    const refilled = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries - 1 },
      (_, index) => `later${String(index)}`,
    );
    const now = landed(y, [{ base: ["keep"], op: "tags", value: ["keep", ...refilled] }]);
    expect(now.fields.tags).toHaveLength(ITEM_FIELD_CAPS.listEntries);
    expect(revert(changeOf(x, y), now, versionsOf(x, y))).toEqual({
      kind: "keep",
      reason: "edited-since",
    });
  });

  it("moves an item it made to Deleted unless a person touched it since", () => {
    const made = itemOf(
      [paragraph("a", "stub")],
      noteFields({ fetchState: "pending", kind: "link" }),
    );
    const change = changeOf(null, made);
    const deleted = stateOf(revert(change, made, versionsOf(made)));
    expect(deleted.fields.deletedAt).toBe(AT);
    // a fill reading the page since is not a person's touch
    const filled = landed(made, [
      { base: "pending", field: "fetchState", op: "set", value: "filled" },
      { block: paragraph("art", "the page"), op: "insert", ord: "a0", section: "article" },
    ]);
    expect(stateOf(revert(change, filled, versionsOf(made, filled))).fields.deletedAt).toBe(AT);
    const retitled = landed(made, [{ base: "A note", field: "title", op: "set", value: "Mine" }]);
    expect(revert(change, retitled, versionsOf(made))).toEqual({
      kind: "keep",
      reason: "edited-since",
    });
    expect(revert(change, null, versionsOf(made))).toEqual({ kind: "unchanged" });
  });

  it("brings back an item the set deleted, and cannot bring back one purged since", () => {
    const x = itemOf([paragraph("a", "one")]);
    const y = landed(x, [{ base: null, field: "deletedAt", op: "set", value: 5 }]);
    expect(stateOf(revert(changeOf(x, y), y, versionsOf(x))).fields.deletedAt).toBeNull();
    expect(revert(changeOf(x, y), null, versionsOf(x))).toEqual({ kind: "keep", reason: "purged" });
  });

  it("takes a highlight back entry by entry, keeping one a marker anchors", () => {
    const x = itemOf([paragraph("a", "one")]);
    const marked: LibraryBlock = {
      children: [
        { children: [{ text: "" }], edge: "start", ids: "h1", type: "annotationMarker" },
        { text: "one" },
        { children: [{ text: "" }], edge: "end", ids: "h1", type: "annotationMarker" },
      ],
      id: "a",
      type: "p",
    };
    const entry = { createdAt: 1, text: "", updatedAt: 1 };
    const loose = revert(changeOf(x, x, { after: { h2: entry } }), x, versionsOf(x), { h2: entry });
    expect(loose).toEqual({
      annotations: {},
      keptAnnotations: false,
      kind: "revert",
      ops: [],
      state: x,
    });
    const anchoredItem = landed(x, [{ baseHash: heldHash(x, "a"), block: marked, op: "put" }]);
    const anchored = revert(
      changeOf(anchoredItem, anchoredItem, { after: { h1: entry } }),
      anchoredItem,
      versionsOf(anchoredItem),
      { h1: entry },
    );
    expect(anchored).toEqual({ kind: "unchanged" });
  });
});

const fieldOps = (rand: () => number, state: ItemState): LibraryOp[] => {
  const ops: LibraryOp[] = [];
  if (rand() < 0.4) {
    ops.push({ base: state.fields.title, field: "title", op: "set", value: `T${String(rand())}` });
  }
  if (rand() < 0.4) {
    ops.push({
      base: state.fields.tags,
      op: "tags",
      value: [...state.fields.tags, pick(rand, ["x", "y", "z"])],
    });
  }
  if (rand() < 0.3) {
    ops.push({ key: "seen", op: "property", value: Math.floor(rand() * 9) });
  }
  return ops;
};

describe("undoing a change set", () => {
  it("returns the item exactly as it was when nothing changed since (seeded)", () => {
    const rand = mulberry32(0x0d_0e_51);
    for (let trial = 0; trial < 400; trial += 1) {
      const x = randomItem(rand, "x", Math.floor(rand() * 7));
      const blocks = randomBlockOps(rand, x, [...x.blocks.keys()], "n", Math.floor(rand() * 5));
      const fields = fieldOps(rand, blocks.state);
      const y = landed(blocks.state, fields);
      const verdict = revert(changeOf(x, y), y, versionsOf(x, y));
      if (verdict.kind === "unchanged") {
        expect(y).toEqual(x);
      } else {
        expect(stateOf(verdict)).toEqual(x);
      }
    }
  });

  // with no moves, a block is a line: revert-edit reads a moved line as one deleted and another
  // inserted, where the block keeps its identity
  it("takes a change back in revert-edit's orientation, block for line (seeded)", () => {
    const rand = mulberry32(0x0e_d1_7a);
    let writes = 0;
    for (let trial = 0; trial < 600; trial += 1) {
      const x = randomItem(rand, "x", 1 + Math.floor(rand() * 6));
      const set = randomBlockOps(rand, x, [...x.blocks.keys()], "s", 1 + Math.floor(rand() * 3), {
        moves: false,
      });
      const y = set.state;
      const later = randomBlockOps(rand, y, [...y.blocks.keys()], "l", Math.floor(rand() * 3), {
        moves: false,
      });
      const now = later.state;
      const lines = revertEdit({
        after: renderLines(y),
        before: renderLines(x),
        current: renderLines(now),
      });
      const item = revert(changeOf(x, y), now, versionsOf(x, y, now));
      if (item.kind === "keep") {
        expect(lines.kind).toBe("keep");
      }
      if (lines.kind === "write") {
        writes += 1;
        expect(renderLines(stateOf(item))).toBe(lines.content);
      }
      if (lines.kind === "unchanged") {
        const final = item.kind === "revert" ? item.state : now;
        expect(renderLines(final)).toBe(renderLines(now));
      }
    }
    expect(writes).toBeGreaterThan(100);
  });
});

describe("revertChangeSets", () => {
  it("undoes a conversation newest first, so a set that edited a block an older one made lands", () => {
    const x = itemOf([paragraph("a", "one")]);
    const older = landed(x, [
      { baseHash: heldHash(x, "a"), block: paragraph("a", "two"), op: "put" },
    ]);
    const newer = landed(older, [
      { baseHash: heldHash(older, "a"), block: paragraph("a", "three"), op: "put" },
    ]);
    const versions = versionsOf(x, older, newer);
    const sets = [
      { id: "newer", items: new Map([["item", changeOf(older, newer)]]) },
      { id: "older", items: new Map([["item", changeOf(x, older)]]) },
    ];
    const now = new Map([["item", { annotations: {}, state: newer }]]);
    const undone = revertChangeSets({ at: AT, blockAt: versions, now, sets });
    expect(undone.kept).toEqual([]);
    const item = undone.items.get("item");
    expect(item?.now.state).toEqual(x);
    expect(item === undefined ? null : landed(newer, item.ops)).toEqual(x);
    const olderAlone = revertChangeSets({ at: AT, blockAt: versions, now, sets: sets.slice(1) });
    expect(olderAlone.kept).toEqual([{ itemId: "item", reason: "edited-since", setId: "older" }]);
  });
});

describe("snapshotOf", () => {
  it("records each block's id, hash, key and section in reading order", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two")]);
    expect(snapshotOf({ annotations: {}, state: x }).manifest).toEqual(
      orderedBlocks(x.blocks).map((held) => ({
        blockId: held.block.id,
        hash: held.hash,
        ord: held.ord,
        section: held.section,
      })),
    );
  });
});
