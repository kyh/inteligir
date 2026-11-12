import { describe, expect, it } from "vitest";

import { saveFolderOf, scopeQuery } from "./library-labels";

const FOLDER = "0199a4c2-0000-7000-8000-0000000000f1";

describe("what a scope asks the listing", () => {
  it("lists the library, Unsorted, a folder with what is under it, a tag, or Deleted", () => {
    expect(scopeQuery({ kind: "all" })).toStrictEqual({ deleted: false });
    expect(scopeQuery({ kind: "unsorted" })).toStrictEqual({ deleted: false, folderId: null });
    expect(scopeQuery({ folderId: FOLDER, kind: "folder" })).toStrictEqual({
      deleted: false,
      folderId: FOLDER,
      subfolders: true,
    });
    expect(scopeQuery({ kind: "tag", tag: "papers" })).toStrictEqual({
      deleted: false,
      tag: "papers",
    });
    expect(scopeQuery({ kind: "deleted" })).toStrictEqual({ deleted: true });
  });

  it("saves where a folder is shown, and in Unsorted from every other scope", () => {
    expect(saveFolderOf({ folderId: FOLDER, kind: "folder" })).toBe(FOLDER);
    expect(saveFolderOf({ kind: "tag", tag: "papers" })).toBeNull();
  });
});
