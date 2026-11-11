import { describe, expect, it } from "vitest";
import { listingPage, listingQuery, saveFolderOf, scopeTitle } from "./library-query";

const FOLDER = "0190a000-0000-7000-8000-0000000000f1";
const NONE = new Set<never>();

describe("the Library's question to the listing", () => {
  it("asks every live item newest first, and Deleted's own", () => {
    expect(listingQuery({ kinds: NONE, scope: { kind: "all" }, words: "" })).toStrictEqual({
      deleted: false,
      kinds: undefined,
      sort: "saved",
    });
    expect(listingQuery({ kinds: NONE, scope: { kind: "deleted" }, words: "" })).toMatchObject({
      deleted: true,
    });
  });

  it("names Unsorted as the items in no folder, and a folder with what is under it", () => {
    expect(listingQuery({ kinds: NONE, scope: { kind: "unsorted" }, words: "" })).toMatchObject({
      folderId: null,
    });
    expect(
      listingQuery({ kinds: NONE, scope: { folderId: FOLDER, kind: "folder" }, words: "" }),
    ).toMatchObject({ folderId: FOLDER, subfolders: true });
  });

  it("narrows to the kinds chosen, and ranks a search by the words on the side it lists", () => {
    const filter = {
      kinds: new Set(["link" as const]),
      scope: { kind: "deleted" as const },
      words: "draft",
    };
    expect(listingPage(filter, 200)).toStrictEqual({
      cursor: 200,
      limit: 100,
      query: { deleted: true, kinds: ["link"], sort: "relevance" },
      words: "draft",
    });
    expect(listingPage({ ...filter, words: "" })).toMatchObject({
      cursor: undefined,
      query: { sort: "saved" },
      words: undefined,
    });
  });

  it("says where it stands, and saves where a folder is shown", () => {
    const folders = [{ id: FOLDER, name: "Recipes" }];
    expect(scopeTitle({ folderId: FOLDER, kind: "folder" }, folders)).toBe("Recipes");
    expect(scopeTitle({ kind: "unsorted" }, folders)).toBe("Unsorted");
    expect(saveFolderOf({ folderId: FOLDER, kind: "folder" })).toBe(FOLDER);
    expect(saveFolderOf({ kind: "tag", tag: "x" })).toBeNull();
  });
});
