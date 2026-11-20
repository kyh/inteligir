import { describe, expect, it } from "vitest";
import type { z } from "zod";

import type { LibraryScope } from "../library-scope";
import { blankItemFields } from "./item-makes";
import { itemListing, itemSummary, LibraryIndex, listingPageOf, sweptIds } from "./library-index";
import type { ItemListing, ListingQuery, ListingRow } from "./library-index";
import type { LibraryItemFields } from "./library-item";
import { listingPageInputSchema } from "./library-wire";

const row = (id: string, overrides: Partial<ListingRow> = {}) =>
  ({
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
  }) satisfies ListingRow;

const query = (overrides: Partial<ListingQuery> = {}) =>
  ({
    deleted: false,
    limit: 50,
    offset: 0,
    order: { by: "saved" },
    ...overrides,
  }) satisfies ListingQuery;

const ids = (index: LibraryIndex<ListingRow>, overrides: Partial<ListingQuery> = {}) =>
  index.items(query(overrides)).items.map((item) => item.id);

const filled = () => {
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
    expect(ids(index, { order: { by: "modified" } })).toStrictEqual([
      "pinned",
      "old",
      "link",
      "new",
    ]);
    expect(ids(index, { order: { by: "title" } })).toStrictEqual(["pinned", "new", "old", "link"]);
    expect(ids(index, { deleted: true })).toStrictEqual(["binned"]);
  });

  it("filters by kind, tag family, folder tree, pin and saved dates, counting kinds apart", () => {
    const index = filled();
    const links = index.items(query({ kinds: ["link"] }));
    expect(links.items.map((item) => item.id)).toStrictEqual(["link"]);
    expect(links.total).toBe(1);
    expect(links.kindCounts).toStrictEqual(expect.objectContaining({ link: 1, note: 3 }));
    expect(ids(index, { tag: "read" })).toStrictEqual(["new", "link"]);
    expect(ids(index, { folderId: "work" })).toStrictEqual(["new", "link"]);
    expect(ids(index, { folderId: "work", tag: "read/later" })).toStrictEqual(["new"]);
    expect(ids(index, { folderId: null })).toStrictEqual(["pinned", "old"]);
    expect(ids(index, { pinned: true })).toStrictEqual(["pinned"]);
    expect(ids(index, { pinned: false })).toStrictEqual(["new", "link", "old"]);
    expect(ids(index, { sinceMs: 3 })).toStrictEqual(["new", "link"]);
    expect(ids(index, { beforeMs: 3 })).toStrictEqual(["pinned", "old"]);
    expect(ids(index, { beforeMs: 5, sinceMs: 3 })).toStrictEqual(["link"]);
  });

  it("orders a search's hits by rank, pinned first, and answers only those on its side", () => {
    const rank = new Map([
      ["old", 1],
      ["link", 0],
      ["binned", 2],
      ["pinned", 5],
    ]);

    const index = filled();
    expect(ids(index, { order: { by: "rank", rank } })).toStrictEqual(["pinned", "link", "old"]);
    expect(ids(index, { deleted: true, order: { by: "rank", rank } })).toStrictEqual(["binned"]);
  });

  it("pages a listing, naming where the next page starts until the list ends", () => {
    const page = filled().items(query({ limit: 2, offset: 1 }));
    expect(page.items.map((item) => item.id)).toStrictEqual(["new", "link"]);
    expect(page).toMatchObject({ next: 3, total: 4 });
    const last = filled().items(query({ limit: 2, offset: 3 }));
    expect(last.items.map((item) => item.id)).toStrictEqual(["old"]);
    expect(last).toMatchObject({ next: null, total: 4 });
    expect(filled().items(query({ limit: 4 })).next).toBeNull();
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

  it("counts an item once under a tag it carries in two spellings", () => {
    const index = filled();
    index.upsert(row("twice", { savedAt: 6, tags: ["Read", "read"] }));
    expect(index.scopes().tags).toStrictEqual([
      { items: 2, tag: "Read" },
      { items: 1, tag: "Read/later" },
    ]);
  });

  it("orders tags held as often by code point, case aside, whatever the runtime's locale", () => {
    const index = filled();
    index.upsert(row("e", { tags: ["éclair"] }));
    index.upsert(row("f", { tags: ["fig"] }));
    expect(index.scopes().tags.map(({ tag }) => tag)).toStrictEqual([
      "fig",
      "read",
      "Read/later",
      "éclair",
    ]);
  });

  it("lists nothing under a folder no longer live, and what was in it as unsorted", () => {
    const index = filled();
    index.setFolders([{ id: "plans", name: "Plans", parentId: "work", sort: "a0" }]);
    expect(ids(index, { folderId: "work" })).toStrictEqual([]);
    expect(ids(index, { folderId: "plans" })).toStrictEqual(["link"]);
    expect(ids(index, { folderId: null })).toStrictEqual(["pinned", "new", "old"]);
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
) =>
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

const answering = () => {
  const index = new LibraryIndex<ItemListing>();
  index.upsert(listing("cherry", { savedAt: 1, title: "Cherry" }));
  index.upsert(listing("apple", { savedAt: 2, title: "Apple" }, ["Fruit", "red"]));
  index.upsert(listing("banana", { savedAt: 3, title: "Banana" }));
  index.upsert(listing("durian", { kind: "link", savedAt: 4, url: "https://example.com/durian" }));

  return index;
};

const whole = (listed: ItemListing) => listed;

const noSearch = (): never => {
  throw new Error("a page with no words searched");
};

const pageOf = (
  index: LibraryIndex<ItemListing>,
  input: z.input<typeof listingPageInputSchema>,
  search: Parameters<typeof listingPageOf>[2] = noSearch,
) => listingPageOf(index, listingPageInputSchema.parse(input), search, whole);

describe(listingPageOf, () => {
  it("pages a scope from where the last page ended, counting each kind", () => {
    const notes = {
      kinds: ["note" as const],
      scope: { kind: "all" as const },
      sort: "title" as const,
    };

    const first = pageOf(answering(), { ...notes, limit: 2 });
    expect(first.items.map(({ card }) => card.title)).toStrictEqual(["Apple", "Banana"]);
    expect(first).toMatchObject({ cursor: 2, kindCounts: { link: 1, note: 3 }, total: 3 });
    expect(first.items[0]).toStrictEqual({
      card: { outline: [], preview: "", title: "Apple", words: 0 },
      fields: expect.objectContaining({ title: "Apple" }),
      id: "apple",
      seq: 1,
      tags: ["Fruit", "red"],
      updatedAt: 0,
    });

    const last = pageOf(answering(), { ...notes, cursor: 2, limit: 2 });
    expect(last.items.map(({ card }) => card.title)).toStrictEqual(["Cherry"]);
    expect(last.cursor).toBeNull();
  });

  it("lists what a scope names: every item, Unsorted, a folder with what is under it, a tag, or Deleted", () => {
    const index = answering();
    const fruit = "01a0f4c2-c400-78d9-a955-7935ec13d6d5";
    const red = "01a0f4c2-c400-78d9-a955-7935ec13d6d6";
    index.setFolders([
      { id: fruit, name: "Fruit", parentId: null, sort: "a0" },
      { id: red, name: "Red", parentId: fruit, sort: "a0" },
    ]);
    index.upsert(listing("apple", { folderId: red, savedAt: 2, title: "Apple" }, ["Fruit"]));
    index.upsert(listing("elder", { deletedAt: 9, savedAt: 5, title: "Elder" }));

    const titles = (scope: LibraryScope) =>
      pageOf(index, { limit: 10, scope }).items.map(({ card }) => card.title);

    expect(titles({ kind: "all" })).toStrictEqual(["durian", "Banana", "Apple", "Cherry"]);
    expect(titles({ kind: "unsorted" })).toStrictEqual(["durian", "Banana", "Cherry"]);
    expect(titles({ folderId: fruit, kind: "folder" })).toStrictEqual(["Apple"]);
    expect(titles({ kind: "tag", tag: "fruit" })).toStrictEqual(["Apple"]);
    expect(titles({ kind: "deleted" })).toStrictEqual(["Elder"]);
  });

  it("answers only a search's hits on the scope's side, best first, cutting a passage for each row of the page alone", () => {
    const cut: string[] = [];
    const asked: [string, boolean][] = [];

    const search = (words: string, deleted: boolean) => {
      asked.push([words, deleted]);

      return {
        passage: (id: string) => {
          cut.push(id);

          return id === "cherry" ? "a cherry tree" : null;
        },
        rank: new Map([
          ["cherry", 0],
          ["banana", 1],
          ["apple", 2],
        ]),
      };
    };

    const page = pageOf(answering(), { limit: 2, scope: { kind: "all" }, words: "tree" }, search);
    expect(page.items.map(({ id, snippet }) => [id, snippet])).toStrictEqual([
      ["cherry", "a cherry tree"],
      ["banana", "Banana"],
    ]);
    expect(page).toMatchObject({ cursor: 2, total: 3 });
    expect(cut).toStrictEqual(["cherry", "banana"]);

    const deleted = pageOf(
      answering(),
      { limit: 2, scope: { kind: "deleted" }, words: "tree" },
      search,
    );

    expect(deleted.items).toStrictEqual([]);
    expect(asked).toStrictEqual([
      ["tree", false],
      ["tree", true],
    ]);
  });
});

describe(sweptIds, () => {
  it("names every item its scope lists, narrowed to its kinds, but those left out", () => {
    const index = filled();
    expect(sweptIds(index, { except: ["old"], scope: { kind: "all" } })).toStrictEqual([
      "pinned",
      "new",
      "link",
    ]);
    expect(
      sweptIds(index, { except: [], kinds: ["link"], scope: { folderId: "work", kind: "folder" } }),
    ).toStrictEqual(["link"]);
    expect(sweptIds(index, { except: [], scope: { kind: "deleted" } })).toStrictEqual(["binned"]);
  });
});

describe(itemSummary, () => {
  it("names an item by its row: every tag it carries, and its saved time as a date", () => {
    const saved = row("a", {
      folderId: "work",
      pinnedAt: 3,
      savedAt: Date.UTC(2026, 0, 2),
      tags: ["Read", "later"],
      url: "https://example.com/a",
    });

    expect(itemSummary(saved)).toStrictEqual({
      folderId: "work",
      id: "a",
      kind: "note",
      pinned: true,
      savedAt: "2026-01-02T00:00:00.000Z",
      tags: ["Read", "later"],
      title: "a",
      url: "https://example.com/a",
    });
  });
});
