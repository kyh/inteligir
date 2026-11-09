import { describe, expect, it } from "vitest";

import { revertEdit } from "../test-support/revert-edit";
import type { RevertVerdict } from "../test-support/revert-edit";
import { orderedBlocks } from "@repo/contract/library/block-ops";
import type { ItemState, LibraryOp } from "@repo/contract/library/block-ops";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { revertChangeSets, revertItemChange, snapshotOf } from "./revert-change";
import type { FillChange, ItemChange, ItemRevert } from "./revert-change";
import {
  itemOf,
  landed,
  noteFields,
  paragraph,
  randomBlockOps,
  randomItem,
  renderLines,
} from "@repo/contract/test-support/library-items";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random";

const AT = 1_800_000_000_000;

const changeOf = (
  before: ItemState | null,
  after: ItemState,
  fills: readonly FillChange[] = [],
): ItemChange => {
  const made = snapshotOf({ state: after });
  return before === null
    ? { after: made, before: null, fills }
    : { after: made, before: snapshotOf({ state: before }) };
};

const fillOf = (before: ItemState, after: ItemState): FillChange => ({
  after: after.fields,
  before: before.fields,
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
): ItemRevert =>
  revertItemChange({
    at: AT,
    blockAt: versions,
    change,
    now: now === null ? null : { state: now },
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

describe(revertItemChange, () => {
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
    expect(revert(changeOf(x, y), now, versionsOf(x, y))).toStrictEqual({
      kind: "keep",
      reason: "edited-since",
    });
  });

  it("brings a deleted block back on its own key, between the blocks around it", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two"), paragraph("c", "three")]);
    const y = landed(x, [{ baseHash: heldHash(x, "b"), blockId: "b", op: "drop" }]);
    const reverted = stateOf(revert(changeOf(x, y), y, versionsOf(x, y)));
    expect(reverted).toStrictEqual(x);
  });

  it("drops a block the set inserted, and keeps one someone edited since", () => {
    const x = itemOf([paragraph("a", "one")]);
    const y = landed(x, [
      { block: paragraph("n", "new"), op: "insert", ord: "a5", section: "note" },
    ]);
    expect(stateOf(revert(changeOf(x, y), y, versionsOf(x, y)))).toStrictEqual(x);
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
    expect(reverted.fields.tags).toStrictEqual(["keep", "later"]);
    expect(reverted.fields.properties).toStrictEqual({});
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
    expect(revert(changeOf(x, y), now, versionsOf(x, y))).toStrictEqual({
      kind: "keep",
      reason: "edited-since",
    });
  });

  it("takes a tag's new spelling back", () => {
    const x = itemOf([], noteFields({ tags: ["Foo"] }));
    const y = landed(x, [{ base: ["Foo"], op: "tags", value: ["foo"] }]);
    expect(stateOf(revert(changeOf(x, y), y, versionsOf(x, y))).fields.tags).toStrictEqual(["Foo"]);
  });

  it("moves an item it made to Deleted unless a person touched it since", () => {
    const made = itemOf(
      [paragraph("a", "stub")],
      noteFields({ fetchState: "pending", kind: "link" }),
    );
    const change = changeOf(null, made);
    const deleted = stateOf(revert(change, made, versionsOf(made)));
    expect(deleted.fields.deletedAt).toBe(AT);
    const retitled = landed(made, [{ base: "A note", field: "title", op: "set", value: "Mine" }]);
    expect(revert(change, retitled, versionsOf(made))).toStrictEqual({
      kind: "keep",
      reason: "edited-since",
    });
    expect(revert(change, null, versionsOf(made))).toStrictEqual({ kind: "unchanged" });
  });

  describe("an item it made that a fill read since", () => {
    const EDITED: ItemRevert = { kind: "keep", reason: "edited-since" };
    const made = itemOf(
      [paragraph("a", "stub")],
      noteFields({ fetchState: "pending", kind: "link" }),
    );
    const read: readonly LibraryOp[] = [
      { base: "pending", field: "fetchState", op: "set", value: "filled" },
      { base: null, field: "originalName", op: "set", value: "page.pdf" },
      { block: paragraph("art", "the page"), op: "insert", ord: "a0", section: "article" },
    ];
    const named: readonly LibraryOp[] = [
      ...read,
      { base: "A note", field: "title", op: "set", value: "The page" },
    ];

    it("still goes to Deleted, whatever the fill wrote", () => {
      const filled = landed(made, named);
      const change = changeOf(null, made, [fillOf(made, filled)]);
      expect(stateOf(revert(change, filled, versionsOf(made, filled))).fields.deletedAt).toBe(AT);
    });

    it("stays once a person changes what the fill wrote", () => {
      const filled = landed(made, named);
      const renamed = landed(filled, [
        { base: "The page", field: "title", op: "set", value: "Mine" },
      ]);
      const change = changeOf(null, made, [fillOf(made, filled)]);
      expect(revert(change, renamed, versionsOf(made, filled))).toStrictEqual(EDITED);
    });

    it("stays when a person's name came first and the fill only left it there", () => {
      const renamed = landed(made, [{ base: "A note", field: "title", op: "set", value: "Mine" }]);
      const filled = landed(renamed, read);
      const change = changeOf(null, made, [fillOf(renamed, filled)]);
      expect(revert(change, filled, versionsOf(made, filled))).toStrictEqual(EDITED);
    });

    it("goes when the set itself wrote a name the fill has since replaced", () => {
      const filled = landed(made, named);
      const renamed = landed(filled, [
        { base: "The page", field: "title", op: "set", value: "Mine" },
      ]);
      const change = changeOf(null, renamed, [fillOf(made, filled)]);
      expect(stateOf(revert(change, renamed, versionsOf(renamed))).fields.deletedAt).toBe(AT);
    });
  });

  it("brings back an item the set deleted, and cannot bring back one purged since", () => {
    const x = itemOf([paragraph("a", "one")]);
    const y = landed(x, [{ base: null, field: "deletedAt", op: "set", value: 5 }]);
    expect(stateOf(revert(changeOf(x, y), y, versionsOf(x))).fields.deletedAt).toBeNull();
    expect(revert(changeOf(x, y), null, versionsOf(x))).toStrictEqual({
      kind: "keep",
      reason: "purged",
    });
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
      expect(verdict.kind === "unchanged" ? y : stateOf(verdict)).toStrictEqual(x);
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
      // the item's verdict against the lines', kind by kind: a keep is a keep, a write writes the
      // lines' content, and lines left unchanged leave the item as it is now
      expect(item.kind !== "keep" || lines.kind === "keep", `${item.kind} vs ${lines.kind}`).toBe(
        true,
      );
      writes += lines.kind === "write" ? 1 : 0;
      const final = item.kind === "revert" ? item.state : now;
      const reached: Record<RevertVerdict["kind"], string | null> = {
        keep: null,
        recreate: null,
        remove: null,
        unchanged: renderLines(final),
        write: lines.kind === "write" ? renderLines(stateOf(item)) : null,
      };
      const wanted: Record<RevertVerdict["kind"], string | null> = {
        keep: null,
        recreate: null,
        remove: null,
        unchanged: renderLines(now),
        write: lines.kind === "write" ? lines.content : null,
      };
      expect(reached[lines.kind], lines.kind).toBe(wanted[lines.kind]);
    }
    expect(writes).toBeGreaterThan(100);
  });
});

describe(revertChangeSets, () => {
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
    const now = new Map([["item", { state: newer }]]);
    const undone = revertChangeSets({ at: AT, blockAt: versions, now, sets });
    expect(undone.kept).toStrictEqual([]);
    const item = undone.items.get("item");
    expect(item?.now.state).toStrictEqual(x);
    expect(item === undefined ? null : landed(newer, item.ops)).toStrictEqual(x);
    const olderAlone = revertChangeSets({ at: AT, blockAt: versions, now, sets: sets.slice(1) });
    expect(olderAlone.kept).toStrictEqual([
      { itemId: "item", reason: "edited-since", setId: "older" },
    ]);
  });

  describe("a set nothing of which goes back", () => {
    const x = itemOf([paragraph("a", "one")]);
    const made = landed(x, [
      { baseHash: heldHash(x, "a"), block: paragraph("a", "two"), op: "put" },
    ]);
    const since = landed(made, [
      { baseHash: heldHash(made, "a"), block: paragraph("a", "three"), op: "put" },
    ]);
    const blockAt = versionsOf(x, made, since);
    const change = changeOf(x, made);

    it("is left whole when what it changed was changed since", () => {
      const undone = revertChangeSets({
        at: AT,
        blockAt,
        now: new Map([["item", { state: since }]]),
        sets: [{ id: "set", items: new Map([["item", change]]) }],
      });
      expect(undone.items.size).toBe(0);
      expect([...undone.leftWhole]).toStrictEqual(["set"]);
    });

    it("is not left whole once anything of it went back, or when nothing was kept", () => {
      const partly = revertChangeSets({
        at: AT,
        blockAt,
        now: new Map([
          ["kept", { state: since }],
          ["back", { state: made }],
        ]),
        sets: [
          {
            id: "set",
            items: new Map([
              ["kept", change],
              ["back", change],
            ]),
          },
        ],
      });
      expect(partly.kept.map((one) => one.itemId)).toStrictEqual(["kept"]);
      expect([...partly.leftWhole]).toStrictEqual([]);
      const alreadyBack = revertChangeSets({
        at: AT,
        blockAt,
        now: new Map([["item", { state: x }]]),
        sets: [{ id: "set", items: new Map([["item", change]]) }],
      });
      expect(alreadyBack.kept).toStrictEqual([]);
      expect([...alreadyBack.leftWhole]).toStrictEqual([]);
    });

    it("is left whole beside a newer set that took back the same item", () => {
      const newest = landed(since, [
        { baseHash: heldHash(since, "a"), block: paragraph("a", "four"), op: "put" },
      ]);
      const undone = revertChangeSets({
        at: AT,
        blockAt: versionsOf(x, made, since, newest),
        now: new Map([["item", { state: newest }]]),
        sets: [
          { id: "newer", items: new Map([["item", changeOf(since, newest)]]) },
          { id: "older", items: new Map([["item", change]]) },
        ],
      });
      expect(undone.items.get("item")?.now.state).toStrictEqual(since);
      expect(undone.kept).toStrictEqual([
        { itemId: "item", reason: "edited-since", setId: "older" },
      ]);
      expect([...undone.leftWhole]).toStrictEqual(["older"]);
    });
  });
});

describe(snapshotOf, () => {
  it("records each block's id, hash, key and section in reading order", () => {
    const x = itemOf([paragraph("a", "one"), paragraph("b", "two")]);
    expect(snapshotOf({ state: x }).manifest).toStrictEqual(
      orderedBlocks(x.blocks).map((held) => ({
        blockId: held.block.id,
        hash: held.hash,
        ord: held.ord,
        section: held.section,
      })),
    );
  });
});
