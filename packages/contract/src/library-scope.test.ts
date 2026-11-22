import { describe, expect, it } from "vitest";

import { itemScopeSchema, libraryScopeSchema, listedScope } from "./library-scope";
import type { LibraryScope } from "./library-scope";

describe("a library scope", () => {
  it("is all of the library, Unsorted, a folder by its id, a tag or Deleted", () => {
    const scopes: LibraryScope[] = [
      { kind: "all" },
      { kind: "unsorted" },
      { parentId: "01a0f4c2-c400-78d9-a955-7935ec13d6d5", kind: "parent" },
      { kind: "tag", tag: "design" },
      { kind: "deleted" },
    ];

    for (const scope of scopes) {
      expect(libraryScopeSchema.parse(scope)).toStrictEqual(scope);
    }

    expect(libraryScopeSchema.validate({ parentId: "", kind: "parent" })).toBe(false);
    expect(libraryScopeSchema.validate({ kind: "parent", path: "Reading" })).toBe(false);
  });

  it("refuses a tag past a line and a folder by anything but its id, wherever a scope is read", () => {
    const refused = [
      { kind: "tag", tag: "t".repeat(1001) },
      { parentId: "Reading", kind: "parent" },
      { parentId: "01a0f4c2-c400-78d9-a955", kind: "parent" },
    ];

    for (const scope of refused) {
      expect(libraryScopeSchema.validate(scope)).toBe(false);
      expect(itemScopeSchema.validate(scope)).toBe(false);
    }

    expect(itemScopeSchema.validate({ kind: "tag", tag: "t".repeat(1000) })).toBe(true);
  });

  it("never names Deleted where it lists items, since nothing there is a library item", () => {
    expect(itemScopeSchema.validate({ kind: "deleted" })).toBe(false);
    expect(itemScopeSchema.validate({ kind: "unsorted" })).toBe(true);
  });
});

describe("a scope as the library reads it now", () => {
  it("reads a folder the library no longer lists as every item, and keeps one it holds", () => {
    const reading = { id: "01a0f4c2-c400-78d9-a955-7935ec13d6d5" };
    expect(listedScope({ parentId: "gone", kind: "parent" }, [reading])).toStrictEqual({
      kind: "all",
    });
    expect(listedScope({ parentId: "gone", kind: "parent" }, [])).toStrictEqual({ kind: "all" });
    const held: LibraryScope = { parentId: reading.id, kind: "parent" };
    expect(listedScope(held, [reading])).toBe(held);
    const tag: LibraryScope = { kind: "tag", tag: "design" };
    expect(listedScope(tag, [])).toBe(tag);
  });
});
