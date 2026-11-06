import { describe, expect, it } from "vitest";

import { itemScopeSchema, libraryScopeSchema } from "./library-scope";
import type { LibraryScope } from "./library-scope";

describe("a library scope", () => {
  it("is all of the library, Unsorted, a folder by its id, a tag or Deleted", () => {
    const scopes: LibraryScope[] = [
      { kind: "all" },
      { kind: "unsorted" },
      { folderId: "01a0f4c2-c400-78d9-a955-7935ec13d6d5", kind: "folder" },
      { kind: "tag", tag: "design" },
      { kind: "deleted" },
    ];
    for (const scope of scopes) {
      expect(libraryScopeSchema.parse(scope)).toStrictEqual(scope);
    }
    expect(libraryScopeSchema.validate({ folderId: "", kind: "folder" })).toBe(false);
    expect(libraryScopeSchema.validate({ kind: "folder", path: "Reading" })).toBe(false);
  });

  it("never names Deleted where it lists items, since nothing there is a library item", () => {
    expect(itemScopeSchema.validate({ kind: "deleted" })).toBe(false);
    expect(itemScopeSchema.validate({ kind: "unsorted" })).toBe(true);
  });
});
