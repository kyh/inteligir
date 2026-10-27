import { describe, expect, it } from "vitest";

import { libraryItemFieldsSchema } from "./library-item";
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
    ["a kind no item is", { kind: "folder" }],
    ["a field no column holds", { colour: "red" }],
  ])("refuse %s", (_, overrides) => {
    expect(libraryItemFieldsSchema.validate({ ...noteFields(), ...overrides })).toBe(false);
  });
});
