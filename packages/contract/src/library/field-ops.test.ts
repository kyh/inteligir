import { describe, expect, it } from "vitest";

import {
  applyFieldOps,
  composeInverse,
  fieldOpSchema,
  mergeListField,
  SCALAR_FIELDS,
} from "./field-ops";
import type { FieldOp } from "./field-ops";
import { ITEM_FIELD_CAPS } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import { noteFixture } from "../test-support/library-items";
import { mulberry32, pick } from "../test-support/seeded-random";

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
    ).toStrictEqual({ kind: "conflict" });
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
    ).toStrictEqual({ kind: "conflict" });
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

// one landing of a writer's on the fields as they stand, and its way back with the landing in
const land = (inverse: readonly FieldOp[], fields: LibraryItemFields, ops: readonly FieldOp[]) => {
  const after = applied(fields, ops);
  return { after, inverse: composeInverse(inverse, fields, after) };
};

const randomLanding = (rand: () => number, fields: LibraryItemFields): FieldOp[] => {
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
    const key = pick(rand, ["a", "b"]);
    ops.push({
      base: Object.hasOwn(fields.properties, key) ? fields.properties[key] : undefined,
      key,
      op: "property",
      value: rand() < 0.3 ? undefined : Math.floor(rand() * 9),
    });
  }
  if (rand() < 0.2) {
    ops.push({
      base: fields.pinnedAt,
      field: "pinnedAt",
      op: "set",
      value: fields.pinnedAt === null ? 1 : null,
    });
  }
  return ops;
};

describe(composeInverse, () => {
  it("takes several landings back to the fields before the first, one op a slot", () => {
    const x = noteFixture({ tags: ["keep"] });
    const one = land([], x, [
      { base: "A note", field: "title", op: "set", value: "B" },
      { base: ["keep"], op: "tags", value: ["keep", "one"] },
    ]);
    const two = land(one.inverse, one.after, [
      { base: "B", field: "title", op: "set", value: "C" },
      { base: ["keep", "one"], op: "tags", value: ["keep", "two"] },
      { key: "rating", op: "property", value: 5 },
    ]);
    expect(two.inverse).toHaveLength(3);
    expect(applied(two.after, two.inverse)).toStrictEqual(x);
  });

  it("drops a slot a later landing put back as it was", () => {
    const one = land([], noteFixture(), [{ base: null, field: "pinnedAt", op: "set", value: 1 }]);
    expect(
      land(one.inverse, one.after, [{ base: 1, field: "pinnedAt", op: "set", value: null }])
        .inverse,
    ).toStrictEqual([]);
  });

  it("never takes back an edit someone made between two landings", () => {
    const one = land([], noteFixture({ tags: ["keep"] }), [
      { base: "A note", field: "title", op: "set", value: "The writer's" },
      { base: ["keep"], op: "tags", value: ["keep", "first"] },
    ]);
    const between = applied(one.after, [
      { base: null, field: "pinnedAt", op: "set", value: 1 },
      { base: "The writer's", field: "title", op: "set", value: "Someone's" },
      { base: [], op: "tags", value: ["theirs"] },
    ]);
    const two = land(one.inverse, between, [
      { base: "Someone's", field: "title", op: "set", value: "The writer's again" },
      { base: [], op: "tags", value: ["second"] },
    ]);
    expect(applied(two.after, two.inverse)).toStrictEqual({ ...between, tags: ["keep", "theirs"] });
  });

  it("meets a slot someone changed after the last landing that wrote it", () => {
    const one = land([], noteFixture(), [
      { base: "A note", field: "title", op: "set", value: "The writer's" },
    ]);
    const two = land(one.inverse, one.after, [
      { base: null, field: "description", op: "set", value: "The writer's" },
    ]);
    const since = applied(two.after, [
      { base: "The writer's", field: "title", op: "set", value: "Someone's" },
    ]);
    expect(applyFieldOps(since, two.inverse)).toStrictEqual({ kind: "conflict" });
  });

  it("takes a tag's new spelling back across landings", () => {
    const one = land([], noteFixture({ tags: ["Foo"] }), [
      { base: ["Foo"], op: "tags", value: ["foo"] },
    ]);
    const two = land(one.inverse, one.after, [
      { base: ["foo"], op: "tags", value: ["foo", "bar"] },
    ]);
    expect(applied(two.after, two.inverse).tags).toStrictEqual(["Foo"]);
  });

  it("takes any run of one writer's landings back to where it began (seeded)", () => {
    const rand = mulberry32(0x0c_0e_05);
    for (let trial = 0; trial < 300; trial += 1) {
      const start = applied(noteFixture(), randomLanding(rand, noteFixture()));
      let { after, inverse } = land([], start, randomLanding(rand, start));
      for (let step = 0; step < 3; step += 1) {
        ({ after, inverse } = land(inverse, after, randomLanding(rand, after)));
      }
      expect(applied(after, inverse)).toStrictEqual(start);
    }
  });
});
