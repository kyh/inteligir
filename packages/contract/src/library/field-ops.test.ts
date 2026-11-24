import { describe, expect, it } from "vitest";

import { applyPropertyOps, mergeListField, propertyOpSchema } from "./field-ops";
import type { PropertyOp } from "./field-ops";
import { ITEM_FIELD_CAPS } from "../items/item-field-caps";
import type { LibraryItemFields } from "./library-item";
import { noteFixture } from "../test-support/library-items.test-utils";

describe(mergeListField, () => {
  it("merges two writers' tags as a set, case folded, so both land", () => {
    expect(mergeListField("tags", ["work", "Read"], ["work"], ["work", "idea"])).toStrictEqual([
      "work",
      "Read",
      "idea",
    ]);
    expect(mergeListField("tags", ["work", "read"], ["work", "read"], ["read"])).toStrictEqual([
      "read",
    ]);
    expect(mergeListField("tags", ["Idea"], [], ["idea"])).toStrictEqual(["Idea"]);
  });

  it("takes a writer's new spelling of a tag where the tag stands", () => {
    expect(mergeListField("tags", ["Foo", "bar"], ["Foo", "bar"], ["bar", "foo"])).toStrictEqual([
      "foo",
      "bar",
    ]);
    expect(mergeListField("tags", ["FOO"], ["Foo"], ["foo"])).toStrictEqual(["foo"]);
    expect(mergeListField("tags", ["Foo", "foo"], ["Foo", "foo"], ["foo"])).toStrictEqual(["foo"]);
  });

  it("leaves a spelling the writer did not change, and a tag someone took out", () => {
    expect(mergeListField("tags", ["FOO"], ["Foo"], ["Foo", "bar"])).toStrictEqual(["FOO", "bar"]);
    expect(mergeListField("tags", [], ["Foo"], ["foo"])).toStrictEqual([]);
  });
});

const applied = (fields: LibraryItemFields, ops: readonly PropertyOp[]) => {
  const outcome = applyPropertyOps(fields, ops);

  if (outcome.kind !== "applied") {
    throw new Error(`ops did not land: ${JSON.stringify(outcome)}`);
  }

  return outcome.fields;
};

describe(applyPropertyOps, () => {
  it("patches one property by its key, absent standing for no property", () => {
    const rated = applied(noteFixture({ properties: { rating: 3 } }), [
      { base: 3, key: "rating", op: "property", value: 4 },
    ]);

    expect(rated.properties).toStrictEqual({ rating: 4 });
    const added = applied(rated, [{ key: "due", op: "property", value: "2026-11-01" }]);
    expect(added.properties).toStrictEqual({ due: "2026-11-01", rating: 4 });
    const removed = applied(added, [{ base: 4, key: "rating", op: "property" }]);
    expect(removed.properties).toStrictEqual({ due: "2026-11-01" });
  });

  it("keeps a key it changes where it stood, and puts a new one last", () => {
    const held = noteFixture({ properties: { a: 1, b: 2, c: 3 } });
    expect(
      Object.keys(applied(held, [{ base: 1, key: "a", op: "property", value: 9 }]).properties),
    ).toStrictEqual(["a", "b", "c"]);
    expect(
      Object.keys(applied(held, [{ key: "d", op: "property", value: 4 }]).properties),
    ).toStrictEqual(["a", "b", "c", "d"]);
  });

  it("reads its own value as done, and lands no batch one of whose bases moved", () => {
    const rated = noteFixture({ properties: { rating: 4 } });
    expect(
      applyPropertyOps(rated, [{ base: 3, key: "rating", op: "property", value: 4 }]),
    ).toStrictEqual({ changed: false, fields: rated, kind: "applied" });
    expect(
      applyPropertyOps(rated, [
        { key: "due", op: "property", value: 1 },
        { base: 9, key: "rating", op: "property", value: 1 },
      ]),
    ).toStrictEqual({ kind: "conflict" });
  });

  it("holds a property's key to a line", () => {
    expect(propertyOpSchema.validate({ key: "", op: "property", value: 1 })).toBe(false);
    expect(
      propertyOpSchema.validate({
        key: "k".repeat(ITEM_FIELD_CAPS.line + 1),
        op: "property",
        value: 1,
      }),
    ).toBe(false);
  });
});
