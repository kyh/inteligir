import { describe, expect, it } from "vitest";

import { patchOf, rowsOf } from "./item-properties";

describe("an item's properties as the panel's rows", () => {
  it("reads each property as the row its value types", () => {
    expect(
      rowsOf({ due: "2026-11-09", done: false, owner: "Ana", meta: { a: 1 }, tags: ["x"] }),
    ).toStrictEqual([
      { key: "due", type: "date", value: "2026-11-09" },
      { key: "done", type: "checkbox", value: false },
      { key: "owner", type: "text", value: "Ana" },
      { key: "meta", raw: '{"a":1}', type: "unsupported" },
      { key: "tags", type: "tags", value: ["x"] },
    ]);
  });

  it("makes one property op over the value the row showed", () => {
    const properties = { owner: "Ana" };
    expect([
      patchOf(properties, { kind: "set", prop: { key: "owner", type: "text", value: "Bo" } }),
      patchOf(properties, { kind: "add", prop: { key: "done", type: "checkbox", value: true } }),
      patchOf(properties, { key: "owner", kind: "remove" }),
    ]).toStrictEqual([
      { base: "Ana", key: "owner", op: "property", value: "Bo" },
      { key: "done", op: "property", value: true },
      { base: "Ana", key: "owner", op: "property" },
    ]);
  });

  it("makes none for an add over a key the item holds, or a row the panel does not edit", () => {
    const properties = { owner: "Ana" };
    expect([
      patchOf(properties, { kind: "add", prop: { key: "owner", type: "text", value: "Bo" } }),
      patchOf(properties, { key: "gone", kind: "remove" }),
      patchOf(properties, { kind: "set", prop: { key: "meta", raw: "{}", type: "unsupported" } }),
    ]).toStrictEqual([null, null, null]);
  });
});
