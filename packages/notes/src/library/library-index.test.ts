import { describe, expect, it } from "vitest";

import { LibraryIndex } from "./library-index";
import type { ListingQuery, ListingRow } from "./library-index";

const row = (id: string, overrides: Partial<ListingRow> = {}): ListingRow => ({
  deletedAt: null,
  folderId: null,
  id,
  kind: "note",
  pinnedAt: null,
  savedAt: 0,
  tags: [],
  title: id,
  updatedAt: 0,
  url: null,
  ...overrides,
});

const query = (overrides: Partial<ListingQuery> = {}): ListingQuery => ({
  deleted: false,
  limit: 50,
  offset: 0,
  sort: "saved",
  ...overrides,
});

const ids = (index: LibraryIndex<ListingRow>, overrides: Partial<ListingQuery> = {}): string[] =>
  index.items(query(overrides)).items.map((item) => item.id);

const filled = (): LibraryIndex<ListingRow> => {
  const index = new LibraryIndex<ListingRow>();
  index.setFolders([
    { id: "work", name: "Work", parentId: null, sort: "a1" },
    { id: "plans", name: "Plans", parentId: "work", sort: "a0" },
    { id: "home", name: "Home", parentId: null, sort: "a0" },
  ]);
  index.upsert(row("old", { savedAt: 1, title: "beta", updatedAt: 9 }));
  index.upsert(row("new", { folderId: "work", savedAt: 5, tags: ["Read/later"], title: "Alpha" }));
  index.upsert(
    row("link", {
      folderId: "plans",
      kind: "link",
      savedAt: 3,
      tags: ["read"],
      title: "gamma",
      url: "https://www.example.com/a",
    }),
  );
  index.upsert(row("pinned", { pinnedAt: 2, savedAt: 0, title: "zeta" }));
  index.upsert(row("binned", { deletedAt: 4, savedAt: 9 }));
  return index;
};

describe(LibraryIndex, () => {
  it("leads every order with pinned items and keeps Deleted apart", () => {
    const index = filled();
    expect(ids(index)).toStrictEqual(["pinned", "new", "link", "old"]);
    expect(ids(index, { sort: "modified" })).toStrictEqual(["pinned", "old", "link", "new"]);
    expect(ids(index, { sort: "title" })).toStrictEqual(["pinned", "new", "old", "link"]);
    expect(ids(index, { deleted: true })).toStrictEqual(["binned"]);
  });

  it("filters by kind, tag family, untagged, folder, site and saved dates, counting kinds apart", () => {
    const index = filled();
    const links = index.items(query({ kinds: ["link"] }));
    expect(links.items.map((item) => item.id)).toStrictEqual(["link"]);
    expect(links.total).toBe(1);
    expect(links.kindCounts).toStrictEqual(expect.objectContaining({ link: 1, note: 3 }));
    expect(ids(index, { tag: "read" })).toStrictEqual(["new", "link"]);
    expect(ids(index, { untagged: true })).toStrictEqual(["pinned", "old"]);
    expect(ids(index, { folderId: "work" })).toStrictEqual(["new"]);
    expect(ids(index, { folderId: "work", subfolders: true })).toStrictEqual(["new", "link"]);
    expect(ids(index, { folderId: null })).toStrictEqual(["pinned", "old"]);
    expect(ids(index, { site: "example.com" })).toStrictEqual(["link"]);
    expect(ids(index, { sinceMs: 3 })).toStrictEqual(["new", "link"]);
    expect(ids(index, { beforeMs: 3 })).toStrictEqual(["pinned", "old"]);
    expect(ids(index, { beforeMs: 5, sinceMs: 3 })).toStrictEqual(["link"]);
  });

  it("orders a search's hits by rank, pinned first, and answers only them", () => {
    const index = filled();
    expect(
      ids(index, {
        sort: "relevance",
        within: new Map([
          ["old", 1],
          ["link", 0],
          ["pinned", 5],
        ]),
      }),
    ).toStrictEqual(["pinned", "link", "old"]);
  });

  it("pages a listing without losing its total", () => {
    const page = filled().items(query({ limit: 2, offset: 1 }));
    expect(page.items.map((item) => item.id)).toStrictEqual(["new", "link"]);
    expect(page.total).toBe(4);
  });

  it("re-sorts only what a change moved", () => {
    const index = filled();
    expect(ids(index)).toStrictEqual(["pinned", "new", "link", "old"]);
    index.upsert(row("old", { savedAt: 10, title: "beta", updatedAt: 9 }));
    expect(ids(index)).toStrictEqual(["pinned", "old", "new", "link"]);
    index.upsert(row("new", { deletedAt: 11, folderId: "work", savedAt: 5, title: "Alpha" }));
    expect(ids(index)).toStrictEqual(["pinned", "old", "link"]);
    index.remove("pinned");
    expect(ids(index)).toStrictEqual(["old", "link"]);
  });

  it("counts the library's scopes, a folder holding what its children hold", () => {
    const index = filled();
    index.upsert(row("orphan", { folderId: "no-such-folder" }));
    expect(index.scopes()).toStrictEqual({
      folders: [
        { id: "home", items: 0 },
        { id: "work", items: 2 },
        { id: "plans", items: 1 },
      ],
      total: 5,
      unsorted: 3,
      untagged: 3,
    });
  });
});
