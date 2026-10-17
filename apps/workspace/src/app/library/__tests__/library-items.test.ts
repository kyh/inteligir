import type { ItemRowWire } from "@repo/contract/local/items/items-schema";
import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";

import { orpc } from "../../api";
import { tagsFromText } from "../item-dialogs";
import { LIBRARY_WINDOW, cachedItemIds, filterRequest, windowsAround } from "../library-items";

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

const rowOf = (path: string, id: string | null): ItemRowWire => ({
  author: null,
  bare: id === null,
  copy: null,
  cover: null,
  description: null,
  fetchError: null,
  fetched: null,
  file: null,
  fileBytes: null,
  folder: "",
  host: null,
  id,
  kind: "note",
  modifiedMs: null,
  path,
  pending: false,
  pinned: false,
  preview: "",
  published: null,
  saved: null,
  site: null,
  tags: [],
  title: path,
  url: null,
});

describe("the ids the rows already read name", () => {
  it("finds a path's id in a listing window or an itemsAt answer, before a change refetches it", () => {
    const queryClient = new QueryClient();
    queryClient.setQueryData(
      orpc.knowledge.items.queryKey({ input: { limit: LIBRARY_WINDOW, offset: 0 } }),
      {
        items: [rowOf("Unsorted/site.test.md", "id-stub"), rowOf("a.png", null)],
        kindCounts: { audio: 0, file: 0, image: 0, link: 0, note: 2, pdf: 0, video: 0 },
        total: 2,
      },
    );
    queryClient.setQueryData(orpc.knowledge.itemsAt.queryKey({ input: { paths: ["b.md"] } }), {
      items: [rowOf("b.md", "id-b")],
    });
    expect(
      Object.fromEntries(
        cachedItemIds(queryClient, ["Unsorted/site.test.md", "a.png", "b.md", "gone.md"]),
      ),
    ).toEqual({ "Unsorted/site.test.md": "id-stub", "b.md": "id-b" });
  });
});
