import { describe, expect, it } from "vitest";

import { blankItemFields } from "./item-makes";
import { itemListing, LibraryIndex, listingPageOf } from "./library-index";
import type { ItemListing, ListingQuery, ListingRow } from "./library-index";
import type { LibraryItemFields } from "./library-item";

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

  it("answers every row to a limit past the count, an unbounded one included", () => {
    expect(ids(filled(), { limit: 10 })).toStrictEqual(["pinned", "new", "link", "old"]);
    expect(ids(filled(), { limit: Number.POSITIVE_INFINITY })).toStrictEqual([
      "pinned",
      "new",
      "link",
      "old",
    ]);
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
      deleted: 1,
      folders: [
        { id: "home", items: 0, name: "Home", parentId: null, sort: "a0" },
        { id: "work", items: 2, name: "Work", parentId: null, sort: "a1" },
        { id: "plans", items: 1, name: "Plans", parentId: "work", sort: "a0" },
      ],
      tags: [
        { items: 1, tag: "read" },
        { items: 1, tag: "Read/later" },
      ],
      total: 5,
      unsorted: 3,
      untagged: 3,
    });
  });

  it("counts a tag under the spelling saved order meets first, the most held first", () => {
    const index = filled();
    index.upsert(row("echo", { savedAt: 4, tags: ["READ"] }));
    expect(index.scopes().tags).toStrictEqual([
      { items: 2, tag: "READ" },
      { items: 1, tag: "Read/later" },
    ]);
  });

  it("titles every item outside Deleted, pinned first", () => {
    expect(filled().titles()).toStrictEqual({
      targets: [
        { id: "pinned", title: "zeta" },
        { id: "new", title: "Alpha" },
        { id: "old", title: "beta" },
        { id: "link", title: "gamma" },
      ],
    });
  });
});

const listing = (
  id: string,
  fields: Partial<LibraryItemFields>,
  tags: readonly string[] = fields.tags ?? [],
): ItemListing =>
  itemListing(
    {
      card: { outline: [], preview: "", title: fields.title ?? id, words: 0 },
      fields: { ...blankItemFields(0), ...fields },
      id,
      seq: 1,
      updatedAt: 0,
    },
    tags,
  );

const answering = (): LibraryIndex<ItemListing> => {
  const index = new LibraryIndex<ItemListing>();
  index.upsert(listing("cherry", { savedAt: 1, title: "Cherry" }));
  index.upsert(listing("apple", { savedAt: 2, title: "Apple" }, ["Fruit", "red"]));
  index.upsert(listing("banana", { savedAt: 3, title: "Banana" }));
  index.upsert(listing("durian", { kind: "link", savedAt: 4, url: "https://example.com/durian" }));
  return index;
};

// the index above holds each row whole
const whole = (listed: ItemListing): ItemListing => listed;

describe(listingPageOf, () => {
  it("pages a listing from where the last page ended, counting each kind", () => {
    const notes = { deleted: false, kinds: ["note" as const], sort: "title" as const };
    const first = listingPageOf(answering(), { limit: 2, query: notes }, null, whole);
    expect(first.items.map(({ card }) => card.title)).toStrictEqual(["Apple", "Banana"]);
    expect(first).toMatchObject({ kindCounts: { link: 1, note: 3 }, nextCursor: 2, total: 3 });
    expect(first.items[0]).toStrictEqual({
      card: { outline: [], preview: "", title: "Apple", words: 0 },
      fields: expect.objectContaining({ title: "Apple" }),
      id: "apple",
      seq: 1,
      tags: ["Fruit", "red"],
      updatedAt: 0,
    });

    const last = listingPageOf(answering(), { cursor: 2, limit: 2, query: notes }, null, whole);
    expect(last.items.map(({ card }) => card.title)).toStrictEqual(["Cherry"]);
    expect(last.nextCursor).toBeNull();
  });

  it("answers only a search's hits, best first, each with the passage that matched", () => {
    const page = listingPageOf(
      answering(),
      { limit: 10, query: { deleted: false, sort: "relevance" } },
      new Map([
        ["cherry", "a cherry tree"],
        ["banana", "banana bread"],
      ]),
      whole,
    );
    expect(page.items.map(({ id, snippet }) => [id, snippet])).toStrictEqual([
      ["cherry", "a cherry tree"],
      ["banana", "banana bread"],
    ]);
    expect(page.total).toBe(2);
  });
});
