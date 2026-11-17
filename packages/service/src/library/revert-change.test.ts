import { describe, expect, it } from "vitest";

import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { nextEntry, revertChangeSets, revertItemChange } from "./revert-change";
import type { ItemNow, ItemRevert, SetEntry } from "./revert-change";
import { noteFixture } from "@repo/contract/test-support/library-items";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random";

const AT = 1_800_000_000_000;

// the entry of a set whose one landing took the item from `before` to `after`
const changeOf = (before: LibraryItemFields | null, after: LibraryItemFields): SetEntry =>
  nextEntry(null, before, after);

const nowOf = (fields: LibraryItemFields, bodyEdited = false): ItemNow => ({ bodyEdited, fields });

const revert = (entry: SetEntry, now: ItemNow | null): ItemRevert =>
  revertItemChange({ at: AT, entry, now });

const fieldsOf = (verdict: ItemRevert): LibraryItemFields => {
  if (verdict.kind !== "revert") {
    throw new Error(`expected a revert, got ${verdict.kind}`);
  }
  return verdict.fields;
};

const retitle = (fields: LibraryItemFields, title: string): LibraryItemFields => ({
  ...fields,
  title,
});

const EDITED: ItemRevert = { kind: "keep", reason: "edited-since" };

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
    expect(revert(change, nowOf(made, true))).toStrictEqual(EDITED);
    expect(revert(change, null)).toStrictEqual({ kind: "unchanged" });
    // a later landing of the set's takes the item as it then stands
    const touched = nextEntry(change, retitled, retitled);
    expect(fieldsOf(revert(touched, nowOf(retitled))).deletedAt).toBe(AT);
  });

  it("brings back an item the set deleted, and cannot bring back one purged since", () => {
    const x = noteFixture();
    const y = { ...x, deletedAt: 5 };
    expect(fieldsOf(revert(changeOf(x, y), nowOf(y))).deletedAt).toBeNull();
    expect(revert(changeOf(x, y), null)).toStrictEqual({ kind: "keep", reason: "purged" });
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
    const sets = [
      { id: "newer", items: new Map([["item", changeOf(older, newer)]]) },
      { id: "older", items: new Map([["item", changeOf(x, older)]]) },
    ];
    const now = new Map([["item", nowOf(newer)]]);
    const undone = revertChangeSets({ at: AT, now, sets });
    expect(undone.kept).toStrictEqual([]);
    expect(undone.items.get("item")?.fields).toStrictEqual(x);
    const olderAlone = revertChangeSets({ at: AT, now, sets: sets.slice(1) });
    expect(olderAlone.kept).toStrictEqual([
      { itemId: "item", reason: "edited-since", setId: "older" },
    ]);
  });

  describe("an entry someone changed since", () => {
    const made = retitle(x, "two");
    const since = retitle(made, "three");
    const change = changeOf(x, made);
    const KEPT = { itemId: "kept", reason: "edited-since", setId: "set" };

    it("is kept beside one of its set that goes back, and none is once the item is back", () => {
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
      expect(partly.kept).toStrictEqual([KEPT]);
      expect([...partly.items.keys()]).toStrictEqual(["back"]);
      const alreadyBack = revertChangeSets({
        at: AT,
        now: new Map([["kept", nowOf(x)]]),
        sets: [{ id: "set", items: new Map([["kept", change]]) }],
      });
      expect(alreadyBack).toStrictEqual({ items: new Map(), kept: [] });
    });

    it("is kept beside a newer set that took back the same item", () => {
      const newest = retitle(since, "four");
      const undone = revertChangeSets({
        at: AT,
        now: new Map([["kept", nowOf(newest)]]),
        sets: [
          { id: "newer", items: new Map([["kept", changeOf(since, newest)]]) },
          { id: "set", items: new Map([["kept", change]]) },
        ],
      });
      expect(undone.items.get("kept")?.fields).toStrictEqual(since);
      expect(undone.kept).toStrictEqual([KEPT]);
    });
  });
});
