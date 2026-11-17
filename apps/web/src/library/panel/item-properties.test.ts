import { describe, expect, it } from "vitest";

import { nameRefusal, propertyOp, rowsOf } from "./item-properties";

describe("an item's properties as the panel's rows", () => {
  it("reads each property as the row its value types", () => {
    expect(
      rowsOf({
        due: "2026-11-09",
        never: "2026-13-45",
        done: false,
        count: 3.5,
        owner: "Ana",
        meta: { a: 1 },
        mixed: [1, "two"],
        empty: null,
        tags: ["x"],
        none: [],
      }),
    ).toStrictEqual([
      { key: "due", type: "date", value: "2026-11-09" },
      { key: "never", type: "text", value: "2026-13-45" },
      { key: "done", type: "checkbox", value: false },
      { key: "count", type: "number", value: 3.5 },
      { key: "owner", type: "text", value: "Ana" },
      { key: "meta", raw: '{"a":1}', type: "unsupported" },
      { key: "mixed", raw: '[1,"two"]', type: "unsupported" },
      { key: "empty", raw: "null", type: "unsupported" },
      { key: "tags", type: "tags", value: ["x"] },
      { key: "none", type: "tags", value: [] },
    ]);
  });

  it("makes one property op over the value the row showed", () => {
    const properties = { owner: "Ana" };
    expect([
      propertyOp(properties, "owner", "Bo"),
      propertyOp(properties, "done", true),
      propertyOp(properties, "owner"),
    ]).toStrictEqual([
      { base: "Ana", key: "owner", op: "property", value: "Bo" },
      { key: "done", op: "property", value: true },
      { base: "Ana", key: "owner", op: "property" },
    ]);
  });

  it("refuses a new property a name the item already has, a field's among them", () => {
    const properties = { owner: "Ana" };
    expect(["owner", "title", "Tags"].map((name) => nameRefusal(properties, name))).toStrictEqual(
      Array.from({ length: 3 }, () => "This item already has one by that name."),
    );
    expect(nameRefusal(properties, "status")).toBeNull();
  });
});
