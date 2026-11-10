// What the apps read of the library, through the cell's own router as oRPC's router client calls
// it: an item whole, a listing's pages, the rail's counts and every title.

import { isOrpcError } from "@repo/contract/v1/errors";
import { ordsBetween } from "@repo/contract/library/order-key";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { createRouterClient } from "@orpc/server";
import { describe, expect, it } from "vitest";

import {
  agentCellIn,
  cellOf,
  clockAt,
  engineIn,
  inCell,
  notesIn,
} from "../test-support/library-cell";
import { cellActorOf } from "./library-principal";
import { libraryRouter } from "./library-router";

const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

// the cell's router as a laptop calls it, beside the engine and the clock it runs on
const cellIn = (state: DurableObjectState) => {
  const clock = clockAt();
  const engine = engineIn(state, clock);
  const library = createRouterClient(libraryRouter, {
    context: {
      actor: () =>
        cellActorOf({
          accountId: "account",
          actor: { door: "page", kind: "session", sessionId: "laptop-1" },
        }),
      agent: agentCellIn(state, engine, { clock }),
      library: engine,
      notes: notesIn(state),
      settle: async (result) => result,
    },
  });
  return { clock, engine, library };
};

const codeOf = async (call: Promise<unknown>): Promise<string> => {
  try {
    await call;
  } catch (error) {
    if (isOrpcError(error)) {
      return error.code;
    }
    throw error;
  }
  throw new Error("the call landed what the test expected it to refuse");
};

const LIVE = { deleted: false, sort: "title" } as const;

describe("what the apps read of the library", () => {
  it("answers an item whole, one in Deleted too, and none once it is purged", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const { item } = await library.items.createNote({
        markdown: "First line.\n\nSecond line.",
        title: "Two lines",
      });
      const whole = await library.items.get({ id: item.id });
      expect(whole).toMatchObject({ fields: { kind: "note", title: "Two lines" }, id: item.id });
      expect(whole.blocks.map(({ block }) => block.type)).toStrictEqual(["p", "p"]);
      expect(whole.seq).toBeGreaterThan(0);

      await library.items.delete({ ids: [item.id] });
      await expect(library.items.get({ id: item.id })).resolves.toMatchObject({
        fields: { deletedAt: expect.any(Number) },
      });
      await library.items.purge({ ids: [item.id] });
      await expect(codeOf(library.items.get({ id: item.id }))).resolves.toBe("NOT_FOUND");
      await expect(codeOf(library.items.get({ id: newId() }))).resolves.toBe("NOT_FOUND");
    });
  });

  it("answers an item's row without its body, and none once it is purged", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const { item } = await library.items.createNote({
        markdown: "# Plans\n\nFirst line.",
        title: "",
      });
      const { blocks, ...whole } = await library.items.get({ id: item.id });
      const row = await library.items.row({ id: item.id });
      expect(row).toStrictEqual(whole);
      expect(row.card.title).toBe("Plans");
      expect(blocks).toHaveLength(2);
      expect("blocks" in row).toBe(false);

      await library.items.delete({ ids: [item.id] });
      await library.items.purge({ ids: [item.id] });
      await expect(codeOf(library.items.row({ id: item.id }))).resolves.toBe("NOT_FOUND");
    });
  });

  it("pages a listing from where the last page ended, counting each kind", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      for (const title of ["Cherry", "Apple", "Banana"]) {
        await library.items.createNote({ markdown: `${title}.`, title });
      }
      await library.items.saveLink({ url: "https://example.com/durian" });

      const first = await library.listing.page({
        limit: 2,
        query: { ...LIVE, kinds: ["note"] },
      });
      expect(first.items.map(({ card }) => card.title)).toStrictEqual(["Apple", "Banana"]);
      expect(first).toMatchObject({ kindCounts: { link: 1, note: 3 }, nextCursor: 2, total: 3 });

      const last = await library.listing.page({
        cursor: first.nextCursor ?? 0,
        limit: 2,
        query: { ...LIVE, kinds: ["note"] },
      });
      expect(last.items.map(({ card }) => card.title)).toStrictEqual(["Cherry"]);
      expect(last.nextCursor).toBeNull();
    });
  });

  it("lists a tag with the tags under it, a folder with its subfolders, and Unsorted", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const filed = await library.items.createNote({ markdown: "Filed.", title: "Filed" });
      const loose = await library.items.createNote({ markdown: "Loose.", title: "Loose" });
      await library.items.organize({
        addTags: ["work/garden"],
        folder: { path: "Projects/Garden" },
        ids: [filed.item.id],
      });
      await library.items.organize({ addTags: ["working"], ids: [loose.item.id] });
      const { folders } = await library.organize.outline();
      const projects = folders.find(({ name }) => name === "Projects")?.id ?? "";

      const titlesOf = async (query: {
        readonly folderId?: string | null;
        readonly subfolders?: boolean;
        readonly tag?: string;
      }) => {
        const page = await library.listing.page({ limit: 10, query: { ...LIVE, ...query } });
        return page.items.map(({ card }) => card.title);
      };
      await expect(titlesOf({ tag: "work" })).resolves.toStrictEqual(["Filed"]);
      await expect(titlesOf({ folderId: projects })).resolves.toStrictEqual([]);
      await expect(titlesOf({ folderId: projects, subfolders: true })).resolves.toStrictEqual([
        "Filed",
      ]);
      await expect(titlesOf({ folderId: null })).resolves.toStrictEqual(["Loose"]);
    });
  });

  it("searches the side its query lists, ranked, each item with the passage that matched", async () => {
    await inCell(cellOf(), async (state) => {
      const { clock, engine, library } = cellIn(state);
      const gone = await library.items.createNote({ markdown: "A fox long gone." });
      clock.now += 60_000;
      engine.runDueJobs(() => {});
      await library.items.delete({ ids: [gone.item.id] });
      // typed a moment ago, so the index has not taken it in: its exact text finds it
      const kept = await library.items.createNote({ markdown: "The fox naps in the sun." });
      await library.items.createNote({ markdown: "The dog barks." });

      const live = await library.listing.page({
        limit: 10,
        query: { deleted: false, sort: "relevance" },
        words: "fox",
      });
      expect(live.items.map(({ id }) => id)).toStrictEqual([kept.item.id]);
      expect(live.items[0]?.snippet).toContain("fox");

      const deleted = await library.listing.page({
        limit: 10,
        query: { deleted: true, sort: "relevance" },
        words: "fox",
      });
      expect(deleted.items.map(({ id }) => id)).toStrictEqual([gone.item.id]);
    });
  });

  it("counts the rail: folders in rail order, each tag once under its spelling", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const [early = "a0", late = "a1"] = ordsBetween(null, null, 2);
      const projects = newId();
      const garden = newId();
      const archive = newId();
      await library.folders.write({
        ops: [
          { id: projects, name: "Projects", op: "create", parentId: null, sort: late },
          { id: garden, name: "Garden", op: "create", parentId: projects, sort: early },
          { id: archive, name: "Archive", op: "create", parentId: null, sort: early },
        ],
      });
      const one = await library.items.createNote({ markdown: "One." });
      const two = await library.items.createNote({ markdown: "Two." });
      const three = await library.items.createNote({ markdown: "Three." });
      await library.items.organize({
        addTags: ["Work"],
        folder: { id: garden },
        ids: [one.item.id],
      });
      await library.items.organize({ addTags: ["Work", "home"], ids: [two.item.id] });
      await library.items.delete({ ids: [three.item.id] });

      await expect(library.listing.scopes()).resolves.toStrictEqual({
        deleted: 1,
        folders: [
          { id: archive, items: 0, name: "Archive", parentId: null, sort: early },
          { id: projects, items: 1, name: "Projects", parentId: null, sort: late },
          { id: garden, items: 1, name: "Garden", parentId: projects, sort: early },
        ],
        tags: [
          { items: 2, tag: "Work" },
          { items: 1, tag: "home" },
        ],
        total: 2,
        unsorted: 1,
        untagged: 0,
      });
    });
  });

  it("titles every item in the library, and none in Deleted", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const beta = await library.items.createNote({ markdown: "B.", title: "Beta" });
      const alpha = await library.items.createNote({ markdown: "A.", title: "alpha" });
      const gone = await library.items.createNote({ markdown: "G.", title: "Gone" });
      await library.items.delete({ ids: [gone.item.id] });
      await expect(library.listing.titles()).resolves.toStrictEqual({
        targets: [
          { id: alpha.item.id, title: "alpha" },
          { id: beta.item.id, title: "Beta" },
        ],
      });
    });
  });

  it("answers a folder write with each folder it changed, as the write left it", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = cellIn(state);
      const [first = "a0"] = ordsBetween(null, null, 1);
      const top = newId();
      const under = newId();
      const created = await library.folders.write({
        ops: [
          { id: top, name: "Top", op: "create", parentId: null, sort: first },
          { id: under, name: "Under", op: "create", parentId: top, sort: first },
        ],
      });
      expect(created.folders).toMatchObject([
        { deletedAt: null, id: top, name: "Top", parentId: null },
        { deletedAt: null, id: under, name: "Under", parentId: top },
      ]);
      expect(created.seq).toBe(created.folders.at(-1)?.seq);

      const deleted = await library.folders.write({ ops: [{ id: top, op: "delete" }] });
      expect(deleted.folders.map(({ id }) => id)).toStrictEqual([top, under]);
      expect(deleted.folders.every(({ deletedAt }) => deletedAt !== null)).toBe(true);

      await expect(
        library.folders.write({ ops: [{ id: top, op: "delete" }] }),
      ).resolves.toMatchObject({ folders: [] });
    });
  });
});
