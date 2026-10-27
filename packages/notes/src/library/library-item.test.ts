import { describe, expect, it } from "vitest";

import { ITEM_FIELD_CAPS, libraryItemFieldsSchema } from "./library-item";
import { noteFields } from "../test-support/library-items";

describe("an item's fields", () => {
  it("hold a note and a saved link", () => {
    expect(libraryItemFieldsSchema.validate(noteFields())).toBe(true);
    expect(
      libraryItemFieldsSchema.validate(
        noteFields({ fetchState: "pending", kind: "link", url: "https://example.com/a" }),
      ),
    ).toBe(true);
  });

  it.each([
    ["an address that is not the web's", { url: "ftp://example.com" }],
    ["a tag that is not a tag", { tags: ["has space"] }],
    ["a title past a line", { title: "t".repeat(1001) }],
    ["properties past a quarter megabyte", { properties: { big: "x".repeat(300 * 1024) } }],
    ["a property named by no line", { properties: { ["k".repeat(ITEM_FIELD_CAPS.line + 1)]: 1 } }],
    [
      "more tags than a list holds",
      { tags: Array.from({ length: ITEM_FIELD_CAPS.listEntries + 1 }, (_, i) => `t${String(i)}`) },
    ],
    [
      "short tags past a list's bytes",
      { tags: Array.from({ length: 100 }, (_, i) => `t${String(i)}${"x".repeat(900)}`) },
    ],
    ["a kind no item is", { kind: "folder" }],
    ["a field no column holds", { colour: "red" }],
  ])("refuse %s", (_, overrides) => {
    expect(libraryItemFieldsSchema.validate({ ...noteFields(), ...overrides })).toBe(false);
  });
});
