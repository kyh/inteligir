import { describe, expect, it } from "vitest";

import { mergeListField } from "./field-ops";

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
