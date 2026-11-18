import { createLibraryChanges } from "@repo/client/library-changes";
import { deferred } from "@repo/contract/deferred";
import { createFakeCell } from "@repo/contract/test-support/fake-cell";
import type { FakeCell } from "@repo/contract/test-support/fake-cell";
import { InfiniteQueryObserver, MutationObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { newId } from "../library/new-id";
import { fakePageLibrary } from "../test-support/fake-page-library";
import { libraryQueries } from "./library-queries";
import { libraryWrites, organizedOverlay } from "./library-writes";
import { createPageQueryClient } from "./v1";

describe(organizedOverlay, () => {
  it("lays a tag change over a row as the cell makes it, case by case", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ tags: ["Spring", "trips"] });
    const laid = organizedOverlay({
      addTags: ["SPRING", "plans"],
      ids: [id],
      removeTags: ["TRIPS"],
    }).row(cell.listed(id));
    expect(laid?.fields.tags).toStrictEqual(["Spring", "plans"]);
    expect(laid?.tags).toStrictEqual(["Spring", "plans"]);
  });

  it("pins, moves and retitles the item and its card", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ folderId: cell.seed.folder("Trips"), title: "Plans" });
    const laid = organizedOverlay({
      folder: null,
      ids: [id],
      pinned: true,
      title: "Trip",
    }).item(cell.held(id));
    expect(laid.fields.folderId).toBeNull();
    expect(laid.fields.pinnedAt).not.toBeNull();
    expect(laid.fields.title).toBe("Trip");
    expect(laid.card.title).toBe("Trip");
  });

  it("lays an item's fields as the fake cell lands them, a tag taken out and put back respelled where it stood", async () => {
    const cell = createFakeCell();
    const folderId = cell.seed.folder("Trips");
    const id = cell.seed.item({ tags: ["Spring", "trips", "work"], title: "Plans" });
    const input = {
      addTags: ["Trips", "plans"],
      folder: { id: folderId },
      ids: [id],
      pinned: true,
      removeTags: ["trips"],
      title: "Trip",
    };

    const laid = organizedOverlay(input).item(cell.held(id));
    await cell.device("laptop").client.library.items.organize(input);

    expect(laid.fields.tags).toStrictEqual(["Spring", "Trips", "work", "plans"]);
    expect(laid.fields).toStrictEqual({
      ...cell.held(id).fields,
      pinnedAt: expect.any(Number),
    });
  });

  it("keeps what the write leaves alone, and an unpinned item's pin goes", () => {
    const cell = createFakeCell();
    const id = cell.seed.item({ folderId: cell.seed.folder("Trips"), pinnedAt: 5, title: "Plans" });
    const row = cell.listed(id);
    const laid = organizedOverlay({ ids: [id], pinned: false }).row(row);
    expect(laid?.fields).toStrictEqual({ ...row.fields, pinnedAt: null });
    expect(laid?.card).toBe(row.card);
  });
});

const WRITES = new Set(["library.items.organize", "library.items.delete", "library.folders.write"]);

// the screen's reads of a cell, nobody watching them, so a settled write's read again only marks
// them, and writes over it the cell answers in turn as `plan` says: refused at once, or held until
// the suite lets them land
const queuedWrites = async (cell: FakeCell, plan: readonly ("refused" | "held")[]) => {
  const held = deferred();
  let asked = 0;
  const { library } = fakePageLibrary({
    answer: async (call) => {
      if (!WRITES.has(call.path)) {
        return;
      }
      const turn = plan[asked];
      asked += 1;
      if (turn === "refused") {
        throw new Error("The cell refused it.");
      }
      await held.promise;
    },
    cell,
  });
  const queryClient = createPageQueryClient();
  const queries = libraryQueries(library.wire);
  const listing = queries.listing({ scope: { kind: "all" } });
  await Promise.all([
    queryClient.infiniteQuery(listing),
    queryClient.query(queries.scopes()),
    ...[...cell.items().keys()].map(async (id) => {
      await queryClient.query(queries.item(id));
    }),
  ]);
  return {
    folders: () => queryClient.getQueryData(queries.scopes().queryKey)?.folders ?? [],
    item: (id: string) => queryClient.getQueryData(queries.item(id).queryKey),
    land: held.resolve,
    listed: () =>
      queryClient.getQueryData(listing.queryKey)?.pages.flatMap((page) => page.items) ?? [],
    queryClient,
    writes: libraryWrites(library),
  };
};

const pinnedIn = (rows: readonly { id: string; fields: { pinnedAt: number | null } }[]) =>
  rows.filter((row) => row.fields.pinnedAt !== null).map((row) => row.id);

describe("a refused write", () => {
  it("puts back its own items alone, leaving a write asked after it", async () => {
    const cell = createFakeCell();
    const first = cell.seed.item({ title: "First" });
    const second = cell.seed.item({ title: "Second" });
    const screen = await queuedWrites(cell, ["refused", "held"]);
    const pin = async (id: string) =>
      await new MutationObserver(screen.queryClient, screen.writes.organize()).mutate({
        ids: [id],
        pinned: true,
      });

    const refused = pin(first);
    const landing = pin(second);
    await expect(refused).rejects.toThrow("The cell refused it.");

    expect(pinnedIn(screen.listed())).toStrictEqual([second]);
    expect(screen.item(first)?.fields.pinnedAt).toBeNull();
    expect(screen.item(second)?.fields.pinnedAt).not.toBeNull();
    screen.land();
    await landing;
    expect(cell.item(second)?.fields.pinnedAt).not.toBeNull();
  });

  it("asked after one already refused, leaves that one's items as its refusal put them", async () => {
    const cell = createFakeCell();
    const first = cell.seed.item({ title: "First" });
    const second = cell.seed.item({ title: "Second" });
    const screen = await queuedWrites(cell, ["refused", "refused"]);
    const pin = async (id: string) =>
      await new MutationObserver(screen.queryClient, screen.writes.organize()).mutate({
        ids: [id],
        pinned: true,
      });

    const refusedFirst = pin(first);
    const refusedSecond = pin(second);
    await expect(refusedFirst).rejects.toThrow("The cell refused it.");
    await expect(refusedSecond).rejects.toThrow("The cell refused it.");

    expect(pinnedIn(screen.listed())).toStrictEqual([]);
    expect(screen.item(first)?.fields.pinnedAt).toBeNull();
    expect(screen.item(second)?.fields.pinnedAt).toBeNull();
  });

  it("lists a deleted item again where it stood, and a delete asked after it stays", async () => {
    const cell = createFakeCell();
    for (const title of ["One", "Two", "Three", "Four"]) {
      cell.seed.item({ title });
    }
    const screen = await queuedWrites(cell, ["refused", "held"]);
    const listed = screen.listed().map((row) => row.id);
    const [, refusedId, , deletedId] = listed;
    if (refusedId === undefined || deletedId === undefined) {
      throw new Error("the cell lists fewer than four items");
    }
    const remove = async (id: string) =>
      await new MutationObserver(screen.queryClient, screen.writes.remove()).mutate({ ids: [id] });

    const refused = remove(refusedId);
    const landing = remove(deletedId);
    await expect(refused).rejects.toThrow("The cell refused it.");

    expect(screen.listed().map((row) => row.id)).toStrictEqual(
      listed.filter((id) => id !== deletedId),
    );
    screen.land();
    await landing;
  });

  it("puts back its own folders alone, leaving a folder write asked after it", async () => {
    const cell = createFakeCell();
    const trips = cell.seed.folder("Trips");
    const screen = await queuedWrites(cell, ["refused", "held"]);
    const refused = new MutationObserver(screen.queryClient, screen.writes.folders()).mutate({
      ops: [{ id: newId(), name: "Plans", op: "create", parentId: null, sort: "a0" }],
    });
    const landing = new MutationObserver(screen.queryClient, screen.writes.folders()).mutate({
      ops: [{ base: "Trips", id: trips, name: "Travel", op: "rename" }],
    });
    await expect(refused).rejects.toThrow("The cell refused it.");

    expect(screen.folders().map((folder) => folder.name)).toStrictEqual(["Travel"]);
    screen.land();
    await landing;
  });
});

describe("a write waiting behind another", () => {
  it("stays laid over a watched listing while the one ahead of it lands, until it lands too", async () => {
    const cell = createFakeCell();
    const first = cell.seed.item({ title: "First" });
    const second = cell.seed.item({ title: "Second" });
    const turns = [deferred(), deferred()];
    let asked = 0;
    const { library } = fakePageLibrary({
      answer: async (call) => {
        if (call.path !== "library.items.organize") {
          return;
        }
        const turn = turns[asked];
        asked += 1;
        await turn?.promise;
      },
      cell,
    });
    const queryClient = createPageQueryClient();
    const listing = libraryQueries(library.wire).listing({ scope: { kind: "all" } });
    const unwatch = new InfiniteQueryObserver(queryClient, listing).subscribe(() => {
      // watched, so a read again fetches it
    });
    const pinned = () =>
      new Set(
        pinnedIn(
          queryClient.getQueryData(listing.queryKey)?.pages.flatMap((page) => page.items) ?? [],
        ),
      );
    await vi.waitFor(() => {
      expect(queryClient.getQueryData(listing.queryKey)).toBeDefined();
    });
    const writes = libraryWrites(library);
    const pin = async (id: string) =>
      await new MutationObserver(queryClient, writes.organize()).mutate({
        ids: [id],
        pinned: true,
      });

    const landingFirst = pin(first);
    const landingSecond = pin(second);
    turns[0]?.resolve();
    await landingFirst;
    await vi.waitFor(() => {
      expect(asked).toBe(2);
    });

    expect(queryClient.isFetching()).toBe(0);
    expect(pinned()).toStrictEqual(new Set([first, second]));
    turns[1]?.resolve();
    await landingSecond;
    await vi.waitFor(() => {
      expect(queryClient.isFetching()).toBe(0);
    });
    expect(pinned()).toStrictEqual(new Set([first, second]));
    expect(cell.item(second)?.fields.pinnedAt).not.toBeNull();
    unwatch();
  });
});

describe("what moved, asked while a write waits", () => {
  it("leaves the write laid over a watched listing until it lands, then reads what moved", async () => {
    const cell = createFakeCell();
    const mine = cell.seed.item({ title: "Mine" });
    const theirs = cell.seed.item({ title: "Theirs" });
    const turn = deferred();
    const { library } = fakePageLibrary({
      answer: async (call) => {
        if (call.path === "library.items.organize") {
          await turn.promise;
        }
      },
      cell,
    });
    const queryClient = createPageQueryClient();
    const changes = createLibraryChanges({
      client: library.wire.client,
      queries: library.wire.orpc,
      queryClient,
    });
    await changes.poll();
    const listing = libraryQueries(library.wire).listing({ scope: { kind: "all" } });
    const unwatch = new InfiniteQueryObserver(queryClient, listing).subscribe(() => {
      // watched, so what moved fetches it
    });
    const rows = () =>
      queryClient.getQueryData(listing.queryKey)?.pages.flatMap((page) => page.items) ?? [];
    await vi.waitFor(() => {
      expect(rows()).toHaveLength(2);
    });

    const landing = new MutationObserver(queryClient, libraryWrites(library).organize()).mutate({
      ids: [mine],
      pinned: true,
    });
    await vi.waitFor(() => {
      expect(pinnedIn(rows())).toStrictEqual([mine]);
    });
    await cell.device("phone").client.library.items.organize({ ids: [theirs], title: "Renamed" });
    await changes.poll();

    expect(queryClient.isFetching()).toBe(0);
    expect(pinnedIn(rows())).toStrictEqual([mine]);
    turn.resolve();
    await landing;
    await vi.waitFor(() => {
      expect(rows().find((row) => row.id === theirs)?.card.title).toBe("Renamed");
    });
    expect(pinnedIn(rows())).toStrictEqual([mine]);
    unwatch();
  });
});
