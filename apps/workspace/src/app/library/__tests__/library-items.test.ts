import { describe, expect, it } from "vitest";

import { tagsFromText } from "../item-dialogs";
import { LIBRARY_WINDOW, filterRequest, windowsAround } from "../library-items";

describe("what the grid asks the index for", () => {
  it("reads Unsorted as its folder, a folder and a tag as themselves, sorted as chosen", () => {
    expect(
      filterRequest({ kind: null, q: null, scope: { kind: "unsorted" }, sort: "saved" }),
    ).toEqual({ folder: "Unsorted", sort: "saved" });
    expect(
      filterRequest({
        kind: null,
        q: null,
        scope: { kind: "folder", path: "Reading" },
        sort: "title",
      }),
    ).toEqual({ folder: "Reading", sort: "title" });
    expect(
      filterRequest({
        kind: "pdf",
        q: null,
        scope: { kind: "tag", tag: "work" },
        sort: "modified",
      }),
    ).toEqual({ kinds: ["pdf"], sort: "modified", tag: "work" });
  });

  it("lets a search rank its own answers, with no sort of the person's", () => {
    expect(
      filterRequest({ kind: null, q: "tides", scope: { kind: "all" }, sort: "saved" }),
    ).toEqual({ q: "tides" });
  });
});

describe("the windows a view reads", () => {
  it("reads the windows in view and one either side, inside the listing", () => {
    expect(windowsAround({ first: 0, last: 30 }, 50)).toEqual([0]);
    expect(windowsAround({ first: 0, last: 30 }, 1000)).toEqual([0, 1]);
    expect(
      windowsAround({ first: LIBRARY_WINDOW * 4 + 10, last: LIBRARY_WINDOW * 5 + 3 }, 10_000),
    ).toEqual([3, 4, 5, 6]);
    expect(windowsAround({ first: 990, last: 999 }, 1000)).toEqual([8, 9]);
  });
});

describe("tags as a person types them", () => {
  it("splits on spaces and commas, drops a leading #, and names each once", () => {
    expect(tagsFromText("#reading  work, #reading,later")).toEqual(["reading", "work", "later"]);
    expect(tagsFromText("  ,  ")).toEqual([]);
  });
});
