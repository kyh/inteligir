import { describe, expect, it } from "vitest";

import { listedScope, listingQuery, saveFolderOf, saveTagsOf, scopeTitle } from "./listing";

const READING = {
  id: "0199a4c2-0000-7000-8000-0000000000f1",
  name: "Reading",
  parentId: null,
  sort: "a0",
};

describe("the grid's listing query", () => {
  it("lists the library, Unsorted, a folder with what is under it, a tag, or Deleted", () => {
    const base = { kind: null, sort: "saved" as const };
    expect(listingQuery({ ...base, scope: { kind: "all" } })).toMatchObject({ deleted: false });
    expect(listingQuery({ ...base, scope: { kind: "unsorted" } })).toMatchObject({
      folderId: null,
    });
    expect(
      listingQuery({ ...base, scope: { folderId: READING.id, kind: "folder" } }),
    ).toMatchObject({
      folderId: READING.id,
      subfolders: true,
    });
    expect(listingQuery({ ...base, scope: { kind: "tag", tag: "papers" } })).toMatchObject({
      tag: "papers",
    });
    expect(listingQuery({ ...base, scope: { kind: "deleted" } })).toMatchObject({ deleted: true });
  });

  it("narrows to the chip's kind only when one is pressed", () => {
    expect(listingQuery({ kind: "pdf", scope: { kind: "all" }, sort: "title" })).toMatchObject({
      kinds: ["pdf"],
      sort: "title",
    });
    expect(listingQuery({ kind: null, scope: { kind: "all" }, sort: "title" })).not.toHaveProperty(
      "kinds",
    );
  });
});

describe("a scope", () => {
  it("reads a folder the library no longer lists as every item", () => {
    expect(listedScope({ folderId: "gone", kind: "folder" }, [READING])).toEqual({ kind: "all" });
    const held = { folderId: READING.id, kind: "folder" as const };
    expect(listedScope(held, [READING])).toBe(held);
  });

  it("titles the header, and says where a save from it lands", () => {
    expect(scopeTitle({ folderId: READING.id, kind: "folder" }, [READING])).toBe("Reading");
    expect(scopeTitle({ kind: "tag", tag: "papers" }, [])).toBe("#papers");
    expect(saveFolderOf({ folderId: READING.id, kind: "folder" })).toBe(READING.id);
    expect(saveFolderOf({ kind: "unsorted" })).toBeNull();
    expect(saveTagsOf({ kind: "tag", tag: "papers" })).toEqual(["papers"]);
  });
});
