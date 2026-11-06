import { describe, expect, it } from "vitest";
import { listingQuery, saveFolderOf, scopeTitle } from "./library-query";

const FOLDER = "0190a000-0000-7000-8000-0000000000f1";
const NONE = new Set<never>();

describe("the Library's question to the listing", () => {
  it("asks every live item newest first, and Deleted's own", () => {
    expect(listingQuery({ hits: null, kinds: NONE, scope: { kind: "all" } })).toMatchObject({
      deleted: false,
      sort: "saved",
    });
    expect(listingQuery({ hits: null, kinds: NONE, scope: { kind: "deleted" } })).toMatchObject({
      deleted: true,
    });
  });

  it("asks for every row, however many the library holds", () => {
    expect(listingQuery({ hits: null, kinds: NONE, scope: { kind: "all" } })).toMatchObject({
      limit: Number.POSITIVE_INFINITY,
      offset: 0,
    });
  });

  it("names Unsorted as the items in no folder, and a folder with what is under it", () => {
    expect(listingQuery({ hits: null, kinds: NONE, scope: { kind: "unsorted" } })).toMatchObject({
      folderId: null,
    });
    expect(
      listingQuery({ hits: null, kinds: NONE, scope: { folderId: FOLDER, kind: "folder" } }),
    ).toMatchObject({ folderId: FOLDER, subfolders: true });
  });

  it("narrows to the kinds chosen, and ranks a search's hits", () => {
    const hits = new Map([["a", 0]]);
    const query = listingQuery({
      hits,
      kinds: new Set(["link"]),
      scope: { kind: "tag", tag: "x" },
    });
    expect(query).toMatchObject({ kinds: ["link"], sort: "relevance", tag: "x", within: hits });
  });

  it("says where it stands, and saves where a folder is shown", () => {
    const folders = [{ id: FOLDER, name: "Recipes", parentId: null, sort: "a0" }];
    expect(scopeTitle({ folderId: FOLDER, kind: "folder" }, folders)).toBe("Recipes");
    expect(scopeTitle({ kind: "unsorted" }, folders)).toBe("Unsorted");
    expect(saveFolderOf({ folderId: FOLDER, kind: "folder" })).toBe(FOLDER);
    expect(saveFolderOf({ kind: "tag", tag: "x" })).toBeNull();
  });
});
