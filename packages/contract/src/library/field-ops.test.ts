import { describe, expect, it } from "vitest";

import { applyFieldOps, fieldOpSchema, mergeListField, SCALAR_FIELDS } from "./field-ops";
import type { FieldOp } from "./field-ops";
import { ITEM_FIELD_CAPS } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { noteFixture } from "../test-support/library-items";

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

const applied = (fields: LibraryItemFields, ops: readonly FieldOp[]): LibraryItemFields => {
  const outcome = applyFieldOps(fields, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`ops did not land: ${JSON.stringify(outcome)}`);
  }
  return outcome.fields;
};

describe("field patches", () => {
  it("lands a field over its base, reads its own value as done, and conflicts otherwise", () => {
    const renamed = applied(noteFixture(), [
      { base: "A note", field: "title", op: "set", value: "B" },
    ]);
    expect(renamed.title).toBe("B");
    expect(
      applyFieldOps(renamed, [{ base: "A note", field: "title", op: "set", value: "B" }]),
    ).toStrictEqual({ changed: false, fields: renamed, kind: "applied" });
    expect(
      applyFieldOps(renamed, [{ base: "A note", field: "title", op: "set", value: "C" }]),
    ).toStrictEqual({
      conflicts: [{ current: "B", field: "title", kind: "field" }],
      kind: "conflict",
    });
  });

  it("merges two writers' tags as a set, so both land", () => {
    const tagged = applied(noteFixture({ tags: ["later"] }), [
      { base: [], op: "tags", value: ["mine"] },
    ]);
    expect(tagged.tags).toStrictEqual(["later", "mine"]);
  });

  it("lands a writer's new spelling of a tag as a change", () => {
    const respelled = applyFieldOps(noteFixture({ tags: ["Foo"] }), [
      { base: ["Foo"], op: "tags", value: ["foo"] },
    ]);
    expect(respelled).toMatchObject({ changed: true, kind: "applied" });
  });

  it("patches one property by its key, absent standing for no property", () => {
    const rated = applied(noteFixture({ properties: { rating: 3 } }), [
      { base: 3, key: "rating", op: "property", value: 4 },
    ]);
    expect(rated.properties).toStrictEqual({ rating: 4 });
    const added = applied(rated, [{ key: "due", op: "property", value: "2026-11-01" }]);
    expect(added.properties).toStrictEqual({ due: "2026-11-01", rating: 4 });
    const removed = applied(added, [{ base: 4, key: "rating", op: "property" }]);
    expect(removed.properties).toStrictEqual({ due: "2026-11-01" });
    expect(
      applyFieldOps(removed, [{ base: 9, key: "due", op: "property", value: 1 }]),
    ).toStrictEqual({
      conflicts: [{ current: "2026-11-01", key: "due", kind: "property" }],
      kind: "conflict",
    });
  });
});

// an alias near a line's length, so a few dozen pass a list's bytes
const alias = (index: number): string => `${String(index)}${"a".repeat(990)}`;

describe("the item's caps over a landed batch", () => {
  it("lands no batch that merges a list past its length, and names the field", () => {
    const full = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries },
      (_, index) => `t${String(index)}`,
    );
    const fields = noteFixture({ tags: full });
    expect(applyFieldOps(fields, [{ base: [], op: "tags", value: ["one-more"] }])).toStrictEqual({
      fields: ["tags"],
      kind: "invalid",
    });
    expect(applyFieldOps(fields, [{ base: ["t0"], op: "tags", value: ["one-more"] }]).kind).toBe(
      "applied",
    );
  });

  it("lands no batch whose lists or properties pass their bytes, though each op is in bounds", () => {
    const aliased = noteFixture({
      aliases: Array.from({ length: 10 }, (_, index) => alias(index)),
    });
    const more = Array.from({ length: 60 }, (_, index) => alias(100 + index));
    expect(fieldOpSchema.validate({ base: [], op: "aliases", value: more })).toBe(true);
    expect(applyFieldOps(aliased, [{ base: [], op: "aliases", value: more }])).toStrictEqual({
      fields: ["aliases"],
      kind: "invalid",
    });
    const noted = noteFixture({ properties: { notes: "x".repeat(200 * 1024) } });
    expect(
      applyFieldOps(noted, [
        { base: "A note", field: "title", op: "set", value: "Renamed" },
        { key: "more", op: "property", value: "y".repeat(100 * 1024) },
      ]),
    ).toStrictEqual({ fields: ["properties"], kind: "invalid" });
  });
});

describe("the op grammar", () => {
  it("has a set op for every field that is not a list", () => {
    const fields = noteFixture();
    expect(SCALAR_FIELDS).toHaveLength(Object.keys(fields).length - 3);
    for (const field of SCALAR_FIELDS) {
      const value = fields[field];
      expect(fieldOpSchema.safeParse({ base: value, field, op: "set", value }).success, field).toBe(
        true,
      );
    }
  });

  it("parses a batch and holds each field's patch to that field's own type", () => {
    expect(
      fieldOpSchema.array().validate([
        { base: null, field: "pinnedAt", op: "set", value: 1 },
        { base: [], op: "tags", value: ["work"] },
      ]),
    ).toBe(true);
    expect(
      fieldOpSchema.validate({ base: null, field: "pinnedAt", op: "set", value: "soon" }),
    ).toBe(false);
    expect(fieldOpSchema.validate({ base: [], op: "tags", value: ["not a tag"] })).toBe(false);
    expect(fieldOpSchema.validate({ key: "", op: "property", value: 1 })).toBe(false);
    expect(
      fieldOpSchema.validate({
        key: "k".repeat(ITEM_FIELD_CAPS.line + 1),
        op: "property",
        value: 1,
      }),
    ).toBe(false);
  });
});
