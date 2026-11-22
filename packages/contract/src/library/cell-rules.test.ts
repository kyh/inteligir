import { describe, expect, it } from "vitest";

import type { ItemKind } from "../items/item-kind";
import { organized, parentRefusal } from "./cell-rules";
import type { ParentReader } from "./cell-rules";
import { noteFixture } from "../test-support/library-items.test-utils";

const TOP = "01890a5d-ac96-774b-bcce-b302099a8001";
const UNDER = "01890a5d-ac96-774b-bcce-b302099a8002";
const GONE = "01890a5d-ac96-774b-bcce-b302099a8003";
const NEW = "01890a5d-ac96-774b-bcce-b302099a8004";
const LIST = "01890a5d-ac96-774b-bcce-b302099a8005";
const NOTE = "01890a5d-ac96-774b-bcce-b302099a8006";

const node = (kind: ItemKind, parentId: string | null, deletedAt: number | null = null) => ({
  deletedAt,
  kind,
  parentId,
});

const held = new Map([
  [TOP, node("folder", null)],
  [UNDER, node("folder", TOP)],
  [GONE, node("folder", null, 5)],
  [LIST, node("list", TOP)],
  [NOTE, node("note", LIST)],
]);

const reader: ParentReader = { item: (id) => held.get(id) ?? null };

describe("a parent an item is filed under", () => {
  it("takes the root and any live parent that holds the item's kind", () => {
    expect(parentRefusal(reader, { id: NEW, kind: "link" }, null)).toBeNull();
    expect(parentRefusal(reader, { id: NEW, kind: "note" }, LIST)).toBeNull();
    expect(parentRefusal(reader, { id: NEW, kind: "link" }, NOTE)).toBeNull();
    expect(parentRefusal(reader, { id: NEW, kind: "list" }, UNDER)).toBeNull();
  });

  it("refuses a parent gone or deleted, under itself, or of a kind that holds no such child", () => {
    expect(parentRefusal(reader, { id: NEW, kind: "note" }, GONE)).toBe("not-found");
    expect(parentRefusal(reader, { id: NEW, kind: "note" }, NEW)).toBe("not-found");
    expect(parentRefusal(reader, { id: TOP, kind: "folder" }, UNDER)).toBe("conflict");
    expect(parentRefusal(reader, { id: NEW, kind: "folder" }, LIST)).toBe("conflict");
    expect(parentRefusal(reader, { id: NEW, kind: "list" }, NOTE)).toBe("conflict");
  });
});

describe(organized, () => {
  const fields = noteFixture({ pinnedAt: 5, tags: ["Foo", "bar"] });

  it("respells a tag taken out and put back where it stood, and keeps when a pin was made", () => {
    const input = { addTags: ["foo", "BAR", "new"], ids: [], pinned: true, removeTags: ["Foo"] };
    expect(organized(fields, input, undefined, 9)).toStrictEqual({
      ...fields,
      tags: ["foo", "bar", "new"],
    });
  });

  it("leaves what it was not asked to change", () => {
    expect(organized(fields, { ids: [] }, undefined, 9)).toStrictEqual(fields);
    expect(organized(fields, { ids: [], pinned: false }, null, 9)).toStrictEqual({
      ...fields,
      pinnedAt: null,
    });
  });
});
