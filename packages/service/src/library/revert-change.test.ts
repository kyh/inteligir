import { describe, expect, it } from "vitest";

import { applyFieldOps } from "@repo/contract/library/field-ops";
import type { FieldOp } from "@repo/contract/library/field-ops";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { revertChangeSets, revertItemChange } from "./revert-change";
import type { FillChange, ItemChange, ItemNow, ItemRevert } from "./revert-change";
import { noteFields } from "@repo/contract/test-support/library-items";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random";

const AT = 1_800_000_000_000;

const landed = (fields: LibraryItemFields, ops: readonly FieldOp[]): LibraryItemFields => {
  const outcome = applyFieldOps(fields, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`the ops did not land: ${outcome.kind}`);
  }
  return outcome.fields;
};

const changeOf = (
  before: LibraryItemFields | null,
  after: LibraryItemFields,
  fills: readonly FillChange[] = [],
): ItemChange => (before === null ? { after, before: null, fills } : { after, before });

const nowOf = (fields: LibraryItemFields, bodyEdited = false): ItemNow => ({ bodyEdited, fields });

const revert = (change: ItemChange, now: ItemNow | null): ItemRevert =>
  revertItemChange({ at: AT, change, now });

const fieldsOf = (verdict: ItemRevert): LibraryItemFields => {
  if (verdict.kind !== "revert") {
    throw new Error(`expected a revert, got ${verdict.kind}`);
  }
  return verdict.fields;
};

const fillOf = (before: LibraryItemFields, after: LibraryItemFields): FillChange => ({
  after,
  before,
});

const retitle = (fields: LibraryItemFields, value: string) =>
  landed(fields, [{ base: fields.title, field: "title", op: "set", value }]);

const EDITED: ItemRevert = { kind: "keep", reason: "edited-since" };

describe(revertItemChange, () => {
  it("reverts fields one by one, tags as a set, and answers an overlap", () => {
    const x = noteFields({ tags: ["keep"], title: "Old" });
    const y = landed(x, [
      { base: "Old", field: "title", op: "set", value: "New" },
      { base: ["keep"], op: "tags", value: ["keep", "added"] },
      { key: "rating", op: "property", value: 5 },
    ]);
    const now = landed(y, [
      { base: ["keep", "added"], op: "tags", value: ["keep", "added", "later"] },
    ]);
    const reverted = fieldsOf(revert(changeOf(x, y), nowOf(now)));
    expect(reverted.title).toBe("Old");
    expect(reverted.tags).toStrictEqual(["keep", "later"]);
    expect(reverted.properties).toStrictEqual({});
    const retitled = landed(y, [{ base: "New", field: "title", op: "set", value: "Newer" }]);
    expect(revert(changeOf(x, y), nowOf(retitled))).toStrictEqual(EDITED);
  });

  it("keeps the item whole when what the set took out no longer fits", () => {
    const x = noteFields({ tags: ["keep", "gone"] });
    const y = landed(x, [{ base: ["keep", "gone"], op: "tags", value: ["keep"] }]);
    const refilled = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries - 1 },
      (_, index) => `later${String(index)}`,
    );
    const now = landed(y, [{ base: ["keep"], op: "tags", value: ["keep", ...refilled] }]);
    expect(now.tags).toHaveLength(ITEM_FIELD_CAPS.listEntries);
    expect(revert(changeOf(x, y), nowOf(now))).toStrictEqual(EDITED);
  });

  it("takes a tag's new spelling back", () => {
    const x = noteFields({ tags: ["Foo"] });
    const y = landed(x, [{ base: ["Foo"], op: "tags", value: ["foo"] }]);
    expect(fieldsOf(revert(changeOf(x, y), nowOf(y))).tags).toStrictEqual(["Foo"]);
  });

  it("moves an item it made to Deleted unless a person touched it since, in its fields or its note", () => {
    const made = noteFields({ fetchState: "pending", kind: "link" });
    const change = changeOf(null, made);
    expect(fieldsOf(revert(change, nowOf(made))).deletedAt).toBe(AT);
    const retitled = landed(made, [{ base: "A note", field: "title", op: "set", value: "Mine" }]);
    expect(revert(change, nowOf(retitled))).toStrictEqual(EDITED);
    expect(revert(change, nowOf(made, true))).toStrictEqual(EDITED);
    expect(revert(change, null)).toStrictEqual({ kind: "unchanged" });
  });

  describe("an item it made that a fill read since", () => {
    const made = noteFields({ fetchState: "pending", kind: "link" });
    const read: readonly FieldOp[] = [
      { base: "pending", field: "fetchState", op: "set", value: "filled" },
      { base: null, field: "originalName", op: "set", value: "page.pdf" },
    ];
    const named: readonly FieldOp[] = [
      ...read,
      { base: "A note", field: "title", op: "set", value: "The page" },
    ];

    it("still goes to Deleted, whatever the fill wrote", () => {
      const filled = landed(made, named);
      const change = changeOf(null, made, [fillOf(made, filled)]);
      expect(fieldsOf(revert(change, nowOf(filled))).deletedAt).toBe(AT);
    });

    it("stays once a person changes what the fill wrote", () => {
      const filled = landed(made, named);
      const renamed = landed(filled, [
        { base: "The page", field: "title", op: "set", value: "Mine" },
      ]);
      const change = changeOf(null, made, [fillOf(made, filled)]);
      expect(revert(change, nowOf(renamed))).toStrictEqual(EDITED);
    });

    it("stays when a person's name came first and the fill only left it there", () => {
      const renamed = landed(made, [{ base: "A note", field: "title", op: "set", value: "Mine" }]);
      const filled = landed(renamed, read);
      const change = changeOf(null, made, [fillOf(renamed, filled)]);
      expect(revert(change, nowOf(filled))).toStrictEqual(EDITED);
    });

    it("goes when the set itself wrote a name the fill has since replaced", () => {
      const filled = landed(made, named);
      const renamed = landed(filled, [
        { base: "The page", field: "title", op: "set", value: "Mine" },
      ]);
      const change = changeOf(null, renamed, [fillOf(made, filled)]);
      expect(fieldsOf(revert(change, nowOf(renamed))).deletedAt).toBe(AT);
    });
  });

  it("brings back an item the set deleted, and cannot bring back one purged since", () => {
    const x = noteFields();
    const y = landed(x, [{ base: null, field: "deletedAt", op: "set", value: 5 }]);
    expect(fieldsOf(revert(changeOf(x, y), nowOf(y))).deletedAt).toBeNull();
    expect(revert(changeOf(x, y), null)).toStrictEqual({ kind: "keep", reason: "purged" });
  });
});

const randomOps = (rand: () => number, fields: LibraryItemFields): FieldOp[] => {
  const ops: FieldOp[] = [];
  if (rand() < 0.5) {
    ops.push({ base: fields.title, field: "title", op: "set", value: `T${String(rand())}` });
  }
  if (rand() < 0.4) {
    ops.push({
      base: fields.tags,
      op: "tags",
      value: [...fields.tags, `${pick(rand, ["x", "y", "z"])}${String(fields.tags.length)}`],
    });
  }
  if (rand() < 0.3) {
    const key = `seen${String(Object.keys(fields.properties).length)}`;
    ops.push({ key, op: "property", value: Math.floor(rand() * 9) });
  }
  if (rand() < 0.2) {
    ops.push({ base: fields.pinnedAt, field: "pinnedAt", op: "set", value: AT });
  }
  return ops;
};

describe("undoing a change set", () => {
  it("returns the item exactly as it was when nothing changed since (seeded)", () => {
    const rand = mulberry32(0x0d_0e_51);
    for (let trial = 0; trial < 400; trial += 1) {
      const x = landed(noteFields(), randomOps(rand, noteFields()));
      const y = landed(x, randomOps(rand, x));
      const verdict = revert(changeOf(x, y), nowOf(y));
      expect(verdict.kind === "unchanged" ? y : fieldsOf(verdict)).toStrictEqual(x);
    }
  });
});

describe(revertChangeSets, () => {
  const x = noteFields({ title: "one" });

  it("undoes a conversation newest first, so a set that changed what an older one wrote lands", () => {
    const older = retitle(x, "two");
    const newer = retitle(older, "three");
    const sets = [
      { id: "newer", items: new Map([["item", changeOf(older, newer)]]) },
      { id: "older", items: new Map([["item", changeOf(x, older)]]) },
    ];
    const now = new Map([["item", nowOf(newer)]]);
    const undone = revertChangeSets({ at: AT, now, sets });
    expect(undone.kept).toStrictEqual([]);
    const item = undone.items.get("item");
    expect(item?.now.fields).toStrictEqual(x);
    expect(item === undefined ? null : landed(newer, item.ops)).toStrictEqual(x);
    const olderAlone = revertChangeSets({ at: AT, now, sets: sets.slice(1) });
    expect(olderAlone.kept).toStrictEqual([
      { itemId: "item", reason: "edited-since", setId: "older" },
    ]);
  });

  describe("a set nothing of which goes back", () => {
    const made = retitle(x, "two");
    const since = retitle(made, "three");
    const change = changeOf(x, made);

    it("is left whole when what it changed was changed since", () => {
      const undone = revertChangeSets({
        at: AT,
        now: new Map([["item", nowOf(since)]]),
        sets: [{ id: "set", items: new Map([["item", change]]) }],
      });
      expect(undone.items.size).toBe(0);
      expect([...undone.leftWhole]).toStrictEqual(["set"]);
    });

    it("is not left whole once anything of it went back, or when nothing was kept", () => {
      const partly = revertChangeSets({
        at: AT,
        now: new Map([
          ["kept", nowOf(since)],
          ["back", nowOf(made)],
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
        now: new Map([["item", nowOf(x)]]),
        sets: [{ id: "set", items: new Map([["item", change]]) }],
      });
      expect(alreadyBack.kept).toStrictEqual([]);
      expect([...alreadyBack.leftWhole]).toStrictEqual([]);
    });

    it("is left whole beside a newer set that took back the same item", () => {
      const newest = retitle(since, "four");
      const undone = revertChangeSets({
        at: AT,
        now: new Map([["item", nowOf(newest)]]),
        sets: [
          { id: "newer", items: new Map([["item", changeOf(since, newest)]]) },
          { id: "older", items: new Map([["item", change]]) },
        ],
      });
      expect(undone.items.get("item")?.now.fields).toStrictEqual(since);
      expect(undone.kept).toStrictEqual([
        { itemId: "item", reason: "edited-since", setId: "older" },
      ]);
      expect([...undone.leftWhole]).toStrictEqual(["older"]);
    });
  });
});
