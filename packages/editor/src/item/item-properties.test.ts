import { describe, expect, it } from "vitest";

import type { FieldOp } from "@repo/contract/library/field-ops";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { noteFixture } from "@repo/contract/test-support/library-items";

import { itemProperties } from "./item-properties";

// the item as a host holds it, recording each op written
const heldItem = (fields: LibraryItemFields | null) => {
  const written: FieldOp[] = [];
  const source = itemProperties({
    fields: () => fields,
    subscribe: () => () => {},
    write: (op) => {
      written.push(op);
    },
  });
  return { source, written };
};

describe("an item's properties as the panel's rows", () => {
  it("reads each property as the row its value types", () => {
    const { source } = heldItem(
      noteFixture({
        properties: { due: "2026-11-09", done: false, owner: "Ana", meta: { a: 1 }, tags: ["x"] },
      }),
    );
    expect(source.read(source.snapshot())).toStrictEqual([
      { key: "due", type: "date", value: "2026-11-09" },
      { key: "done", type: "checkbox", value: false },
      { key: "owner", type: "text", value: "Ana" },
      { key: "meta", raw: '{"a":1}', type: "unsupported" },
      { key: "tags", type: "tags", value: ["x"] },
    ]);
  });

  it("writes one property op over the value the item holds", () => {
    const { source, written } = heldItem(noteFixture({ properties: { owner: "Ana" } }));
    source.commit({ kind: "set", prop: { key: "owner", type: "text", value: "Bo" } });
    source.commit({ kind: "add", prop: { key: "done", type: "checkbox", value: true } });
    source.commit({ key: "owner", kind: "remove" });
    expect(written).toStrictEqual([
      { base: "Ana", key: "owner", op: "property", value: "Bo" },
      { key: "done", op: "property", value: true },
      { base: "Ana", key: "owner", op: "property" },
    ]);
  });

  it("writes nothing for an edit that no longer applies, or before the fields come", () => {
    const { source, written } = heldItem(noteFixture({ properties: { owner: "Ana" } }));
    source.commit({ kind: "add", prop: { key: "owner", type: "text", value: "Bo" } });
    source.commit({ key: "gone", kind: "remove" });
    source.commit({ kind: "set", prop: { key: "meta", raw: "{}", type: "unsupported" } });
    const pending = heldItem(null);
    pending.source.commit({ kind: "add", prop: { key: "owner", type: "text", value: "Bo" } });
    expect(pending.source.read(pending.source.snapshot())).toStrictEqual([]);
    expect([...written, ...pending.written]).toStrictEqual([]);
  });
});
