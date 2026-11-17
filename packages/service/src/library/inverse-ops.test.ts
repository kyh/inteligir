import { describe, expect, it } from "vitest";

import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { noteFixture } from "@repo/contract/test-support/library-items";
import { mulberry32, pick } from "@repo/contract/test-support/seeded-random";
import { applyInverse, composeInverse, inverseOpSchema, SCALAR_FIELDS } from "./inverse-ops";
import type { InverseOp } from "./inverse-ops";

const applied = (fields: LibraryItemFields, ops: readonly InverseOp[]): LibraryItemFields => {
  const outcome = applyInverse(fields, ops);
  if (outcome.kind !== "applied") {
    throw new Error(`ops did not land: ${JSON.stringify(outcome)}`);
  }
  return outcome.fields;
};

describe(applyInverse, () => {
  it("lands a field over its base, reads its own value as done, and conflicts otherwise", () => {
    const renamed = applied(noteFixture(), [
      { base: "A note", field: "title", op: "set", value: "B" },
    ]);
    expect(renamed.title).toBe("B");
    expect(
      applyInverse(renamed, [{ base: "A note", field: "title", op: "set", value: "B" }]),
    ).toStrictEqual({ changed: false, fields: renamed, kind: "applied" });
    expect(
      applyInverse(renamed, [{ base: "A note", field: "title", op: "set", value: "C" }]),
    ).toStrictEqual({ kind: "conflict" });
  });

  it("merges a list as a set, so what someone added since stays", () => {
    const tagged = applied(noteFixture({ tags: ["later"] }), [
      { base: [], op: "tags", value: ["mine"] },
    ]);
    expect(tagged.tags).toStrictEqual(["later", "mine"]);
    expect(
      applyInverse(noteFixture({ tags: ["Foo"] }), [{ base: ["Foo"], op: "tags", value: ["foo"] }]),
    ).toMatchObject({ changed: true, kind: "applied" });
  });

  it("meets a reading by its value, however equal a copy of its base reads", () => {
    const waiting = { at: 1, state: "pending" } as const;
    const read = { at: 2, state: "read" } as const;
    const link = noteFixture({ kind: "link", reading: { ...read } });
    const back: readonly InverseOp[] = [
      { base: { ...read }, field: "reading", op: "set", value: waiting },
    ];
    expect(applied(link, back).reading).toStrictEqual(waiting);
    expect(applyInverse({ ...link, reading: { ...waiting } }, back)).toMatchObject({
      changed: false,
      kind: "applied",
    });
    const failed = { at: 3, error: "Timed out.", state: "failed" } as const;
    expect(applyInverse({ ...link, reading: failed }, back)).toStrictEqual({ kind: "conflict" });
    // a landing that reads the same reading anew from its row writes no slot
    expect(composeInverse([], link, { ...link, reading: { ...read } })).toStrictEqual([]);
  });
});

describe("an op of the way back", () => {
  it("has a set op for every field that is not a list", () => {
    const fields = noteFixture();
    expect(SCALAR_FIELDS).toHaveLength(Object.keys(fields).length - 3);
    for (const field of SCALAR_FIELDS) {
      const value = fields[field];
      expect(
        inverseOpSchema.safeParse({ base: value, field, op: "set", value }).success,
        field,
      ).toBe(true);
    }
  });

  it("holds each field's op to that field's own type", () => {
    expect(
      inverseOpSchema.array().validate([
        { base: null, field: "pinnedAt", op: "set", value: 1 },
        { base: [], op: "tags", value: ["work"] },
      ]),
    ).toBe(true);
    expect(
      inverseOpSchema.validate({ base: null, field: "pinnedAt", op: "set", value: "soon" }),
    ).toBe(false);
    expect(inverseOpSchema.validate({ base: [], op: "tags", value: ["not a tag"] })).toBe(false);
  });
});

// one landing of a writer's on the fields as they stand, and its way back with the landing in
const land = (
  inverse: readonly InverseOp[],
  fields: LibraryItemFields,
  change: Partial<LibraryItemFields>,
) => {
  const after = { ...fields, ...change };
  return { after, inverse: composeInverse(inverse, fields, after) };
};

const randomLanding = (rand: () => number, fields: LibraryItemFields) => {
  const change: Partial<LibraryItemFields> = {};
  if (rand() < 0.5) {
    change.title = `T${String(rand())}`;
  }
  if (rand() < 0.4) {
    change.tags = [...fields.tags, `${pick(rand, ["x", "y", "z"])}${String(fields.tags.length)}`];
  }
  if (rand() < 0.3) {
    const key = pick(rand, ["a", "b"]);
    const others = Object.entries(fields.properties).filter(([name]) => name !== key);
    change.properties = Object.fromEntries(
      rand() < 0.3 ? others : [...others, [key, Math.floor(rand() * 9)]],
    );
  }
  if (rand() < 0.2) {
    change.pinnedAt = fields.pinnedAt === null ? 1 : null;
  }
  return change;
};

describe(composeInverse, () => {
  it("takes several landings back to the fields before the first, one op a slot", () => {
    const x = noteFixture({ tags: ["keep"] });
    const one = land([], x, { tags: ["keep", "one"], title: "B" });
    const two = land(one.inverse, one.after, {
      properties: { rating: 5 },
      tags: ["keep", "two"],
      title: "C",
    });
    expect(two.inverse).toHaveLength(3);
    expect(applied(two.after, two.inverse)).toStrictEqual(x);
  });

  it("drops a slot a later landing put back as it was", () => {
    const one = land([], noteFixture(), { pinnedAt: 1 });
    expect(land(one.inverse, one.after, { pinnedAt: null }).inverse).toStrictEqual([]);
  });

  it("never takes back an edit someone made between two landings", () => {
    const one = land([], noteFixture({ tags: ["keep"] }), {
      tags: ["keep", "first"],
      title: "The writer's",
    });
    const between: LibraryItemFields = {
      ...one.after,
      pinnedAt: 1,
      tags: ["keep", "first", "theirs"],
      title: "Someone's",
    };
    const two = land(one.inverse, between, {
      tags: ["keep", "first", "theirs", "second"],
      title: "The writer's again",
    });
    expect(applied(two.after, two.inverse)).toStrictEqual({ ...between, tags: ["keep", "theirs"] });
  });

  it("meets a slot someone changed after the last landing that wrote it", () => {
    const one = land([], noteFixture(), { title: "The writer's" });
    const two = land(one.inverse, one.after, { description: "The writer's" });
    const since = { ...two.after, title: "Someone's" };
    expect(applyInverse(since, two.inverse)).toStrictEqual({ kind: "conflict" });
  });

  it("takes a tag's new spelling back across landings", () => {
    const one = land([], noteFixture({ tags: ["Foo"] }), { tags: ["foo"] });
    const two = land(one.inverse, one.after, { tags: ["foo", "bar"] });
    expect(applied(two.after, two.inverse).tags).toStrictEqual(["Foo"]);
  });

  it("takes any run of one writer's landings back to where it began (seeded)", () => {
    const rand = mulberry32(0x0c_0e_05);
    for (let trial = 0; trial < 300; trial += 1) {
      const start = { ...noteFixture(), ...randomLanding(rand, noteFixture()) };
      let { after, inverse } = land([], start, randomLanding(rand, start));
      for (let step = 0; step < 3; step += 1) {
        ({ after, inverse } = land(inverse, after, randomLanding(rand, after)));
      }
      expect(applied(after, inverse)).toStrictEqual(start);
    }
  });
});
