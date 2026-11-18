import type { BodyBlock } from "@repo/contract/library/derive-item";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random";
import { describe, expect, it } from "vitest";

import { nextEntry, revertChangeSets, revertItemChange } from "./revert-change";
import type { BodyEntry, ItemBack, ItemEntry, ItemNow, ItemRevert } from "./revert-change";

const AT = 1_800_000_000_000;

// the entry of a set whose one landing took the item's fields from `before` to `after`, and its
// body when it wrote one
const changeOf = (
  before: LibraryItemFields | null,
  after: LibraryItemFields,
  body: BodyEntry | null = null,
): ItemEntry => ({ body, fields: nextEntry(null, before, after) });

const nowOf = (fields: LibraryItemFields, bodyVersion = 1): ItemBack => ({
  blocks: null,
  bodyVersion,
  fields,
});

const revert = (entry: ItemEntry, now: ItemBack): ItemRevert =>
  revertItemChange({ at: AT, entry, now });

// a set as an undo reads it: each of its entries beside its item as it stands now
const setOf = (id: string, entries: readonly (readonly [string, ItemEntry, ItemNow])[]) => ({
  id,
  items: new Map(entries.map(([itemId, entry, now]) => [itemId, { entry, now }])),
});

const backOf = (verdict: ItemRevert): ItemBack => {
  if (verdict.kind !== "revert") {
    throw new Error(`expected a revert, got ${verdict.kind}`);
  }
  return verdict.back;
};

const fieldsOf = (verdict: ItemRevert): LibraryItemFields => backOf(verdict).fields;

const blocksOf = (text: string): BodyBlock[] => [{ block: paragraph(text, text), section: "note" }];

const retitle = (fields: LibraryItemFields, title: string): LibraryItemFields => ({
  ...fields,
  title,
});

const EDITED: ItemRevert = { kind: "keep" };

describe(revertItemChange, () => {
  it("reverts fields one by one, tags as a set, and answers an overlap", () => {
    const x = noteFixture({ tags: ["keep"], title: "Old" });
    const y = { ...x, properties: { rating: 5 }, tags: ["keep", "added"], title: "New" };
    const now = { ...y, tags: ["keep", "added", "later"] };
    const reverted = fieldsOf(revert(changeOf(x, y), nowOf(now)));
    expect(reverted.title).toBe("Old");
    expect(reverted.tags).toStrictEqual(["keep", "later"]);
    expect(reverted.properties).toStrictEqual({});
    expect(revert(changeOf(x, y), nowOf(retitle(y, "Newer")))).toStrictEqual(EDITED);
  });

  it("keeps the item whole when what the set took out no longer fits", () => {
    const x = noteFixture({ tags: ["keep", "gone"] });
    const y = { ...x, tags: ["keep"] };
    const refilled = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries - 1 },
      (_, index) => `later${String(index)}`,
    );
    const now = { ...y, tags: ["keep", ...refilled] };
    expect(now.tags).toHaveLength(ITEM_FIELD_CAPS.listEntries);
    expect(revert(changeOf(x, y), nowOf(now))).toStrictEqual(EDITED);
  });

  it("takes a tag's new spelling back", () => {
    const x = noteFixture({ tags: ["Foo"] });
    const y = { ...x, tags: ["foo"] };
    expect(fieldsOf(revert(changeOf(x, y), nowOf(y))).tags).toStrictEqual(["Foo"]);
  });

  it("moves an item it made to Deleted unless a person touched it since, in its fields or its note", () => {
    const made = noteFixture({ kind: "link", reading: { at: null, state: "pending" } });
    const change = changeOf(null, made);
    expect(fieldsOf(revert(change, nowOf(made))).deletedAt).toBe(AT);
    const retitled = retitle(made, "Mine");
    expect(revert(change, nowOf(retitled))).toStrictEqual(EDITED);
    const written = changeOf(null, made, { blocksBefore: [], versionAfter: 1, versionBefore: 0 });
    expect(fieldsOf(revert(written, nowOf(made, 1))).deletedAt).toBe(AT);
    expect(revert(written, nowOf(made, 2))).toStrictEqual(EDITED);
    expect(revert(change, nowOf({ ...made, deletedAt: 5 }))).toStrictEqual({ kind: "unchanged" });
    // a later landing of the set's takes the item as it then stands
    const touched = { body: null, fields: nextEntry(change.fields, retitled, retitled) };
    expect(fieldsOf(revert(touched, nowOf(retitled))).deletedAt).toBe(AT);
  });

  it("brings back an item the set deleted", () => {
    const x = noteFixture();
    const y = { ...x, deletedAt: 5 };
    expect(fieldsOf(revert(changeOf(x, y), nowOf(y))).deletedAt).toBeNull();
  });

  it("brings a body back to its blocks before the set while it stands where the set left it", () => {
    const x = noteFixture({ title: "Old" });
    const y = retitle(x, "New");
    const body = { blocksBefore: blocksOf("before"), versionAfter: 3, versionBefore: 2 };
    expect(backOf(revert(changeOf(x, y, body), nowOf(y, 3)))).toStrictEqual({
      blocks: body.blocksBefore,
      bodyVersion: 2,
      fields: x,
    });
    expect(backOf(revert(changeOf(x, x, body), nowOf(x, 3))).blocks).toStrictEqual(
      body.blocksBefore,
    );
    // a body written since keeps the whole item, its fields too
    expect(revert(changeOf(x, y, body), nowOf(y, 4))).toStrictEqual(EDITED);
  });
});

// the fields as one landing of a writer's leaves them
const randomLanding = (rand: () => number, fields: LibraryItemFields): LibraryItemFields => {
  const count = Object.keys(fields.properties).length;
  return {
    ...fields,
    pinnedAt: rand() < 0.2 ? AT : fields.pinnedAt,
    properties:
      rand() < 0.3
        ? { ...fields.properties, [`seen${String(count)}`]: Math.floor(rand() * 9) }
        : fields.properties,
    tags:
      rand() < 0.4
        ? [...fields.tags, `${pick(rand, ["x", "y", "z"])}${String(fields.tags.length)}`]
        : fields.tags,
    title: rand() < 0.5 ? `T${String(rand())}` : fields.title,
  };
};

describe("undoing a change set", () => {
  it("returns the item exactly as it was when nothing changed since (seeded)", () => {
    const rand = mulberry32(0x0d_0e_51);
    for (let trial = 0; trial < 400; trial += 1) {
      const x = randomLanding(rand, noteFixture());
      const y = randomLanding(rand, x);
      const verdict = revert(changeOf(x, y), nowOf(y));
      expect(verdict.kind === "unchanged" ? y : fieldsOf(verdict)).toStrictEqual(x);
    }
  });
});

describe(revertChangeSets, () => {
  const x = noteFixture({ title: "one" });

  it("undoes a conversation newest first, so a set that changed what an older one wrote lands", () => {
    const older = retitle(x, "two");
    const newer = retitle(older, "three");
    const now = { bodyVersion: 1, fields: newer };
    const sets = [
      setOf("newer", [["item", changeOf(older, newer), now]]),
      setOf("older", [["item", changeOf(x, older), now]]),
    ];
    const undone = revertChangeSets({ at: AT, sets });
    expect(undone.kept).toStrictEqual([]);
    expect(undone.items.get("item")?.fields).toStrictEqual(x);
    const olderAlone = revertChangeSets({ at: AT, sets: sets.slice(1) });
    expect(olderAlone.kept).toStrictEqual([{ itemId: "item", setId: "older" }]);
  });

  describe("an entry someone changed since", () => {
    const made = retitle(x, "two");
    const since = retitle(made, "three");
    const change = changeOf(x, made);
    const KEPT = { itemId: "kept", setId: "set" };

    it("is kept beside one of its set that goes back, and none is once the item is back", () => {
      const partly = revertChangeSets({
        at: AT,
        sets: [
          setOf("set", [
            ["kept", change, { bodyVersion: 1, fields: since }],
            ["back", change, { bodyVersion: 1, fields: made }],
          ]),
        ],
      });
      expect(partly.kept).toStrictEqual([KEPT]);
      expect([...partly.items.keys()]).toStrictEqual(["back"]);
      const alreadyBack = revertChangeSets({
        at: AT,
        sets: [setOf("set", [["kept", change, { bodyVersion: 1, fields: x }]])],
      });
      expect(alreadyBack).toStrictEqual({ items: new Map(), kept: [] });
    });

    it("is kept beside a newer set that took back the same item", () => {
      const newest = retitle(since, "four");
      const now = { bodyVersion: 1, fields: newest };
      const undone = revertChangeSets({
        at: AT,
        sets: [
          setOf("newer", [["kept", changeOf(since, newest), now]]),
          setOf("set", [["kept", change, now]]),
        ],
      });
      expect(undone.items.get("kept")?.fields).toStrictEqual(since);
      expect(undone.kept).toStrictEqual([KEPT]);
    });
  });

  it("takes a body back across turns only while each began where the older one ended", () => {
    const now = { bodyVersion: 4, fields: x };
    const sets = (between: number) => [
      setOf("newer", [
        [
          "item",
          changeOf(x, x, {
            blocksBefore: blocksOf("two"),
            versionAfter: 4,
            versionBefore: between,
          }),
          now,
        ],
      ]),
      setOf("older", [
        [
          "item",
          changeOf(x, x, { blocksBefore: blocksOf("one"), versionAfter: 2, versionBefore: 1 }),
          now,
        ],
      ]),
    ];
    const chained = revertChangeSets({ at: AT, sets: sets(2) });
    expect(chained.items.get("item")).toStrictEqual({
      blocks: blocksOf("one"),
      bodyVersion: 1,
      fields: x,
    });
    // someone wrote the body between the two turns
    const broken = revertChangeSets({ at: AT, sets: sets(3) });
    expect(broken.items.get("item")?.blocks).toStrictEqual(blocksOf("two"));
    expect(broken.kept).toStrictEqual([{ itemId: "item", setId: "older" }]);
  });
});
