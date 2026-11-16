// What the apps read of the library, through the cell's own router as oRPC's router client calls
// it: an item whole, a listing's pages, the rail's counts and every title.

import { isOrpcError } from "@repo/contract/v1/errors";
import type { LibraryScope } from "@repo/contract/library-scope";
import { uuidV7 } from "@repo/contract/library/uuid-v7";
import { describe, expect, it } from "vitest";

import { cellIn, cellOf, clockAt, inCell } from "../test-support/library-cell";

const newId = (): string => uuidV7(Date.now(), crypto.getRandomValues(new Uint8Array(16)));

// the cell's router as a laptop calls it, beside the engine and the clock it runs on
const laptopIn = (state: DurableObjectState) => {
  const clock = clockAt();
  const { client, library } = cellIn(state, { clock });
  return { clock, engine: library, library: client };
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

const BY_TITLE = { scope: { kind: "all" }, sort: "title" } as const;

describe("what the apps read of the library", () => {
  it("answers an item whole, one in Deleted too, and none once it is purged", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = laptopIn(state);
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
      const { library } = laptopIn(state);
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
      const { library } = laptopIn(state);
      for (const title of ["Cherry", "Apple", "Banana"]) {
        await library.items.createNote({ markdown: `${title}.`, title });
      }
      await library.items.saveLink({ url: "https://example.com/durian" });

      const first = await library.listing.page({ ...BY_TITLE, kinds: ["note"], limit: 2 });
      expect(first.items.map(({ card }) => card.title)).toStrictEqual(["Apple", "Banana"]);
      expect(first).toMatchObject({ cursor: 2, kindCounts: { link: 1, note: 3 }, total: 3 });

      const last = await library.listing.page({
        ...BY_TITLE,
        cursor: first.cursor ?? 0,
        kinds: ["note"],
        limit: 2,
      });
      expect(last.items.map(({ card }) => card.title)).toStrictEqual(["Cherry"]);
      expect(last.cursor).toBeNull();
    });
  });

  it("lists a tag with the tags under it, a folder with what is under it, and Unsorted", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = laptopIn(state);
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

      const titlesOf = async (scope: LibraryScope) => {
        const page = await library.listing.page({ limit: 10, scope, sort: "title" });
        return page.items.map(({ card }) => card.title);
      };
      await expect(titlesOf({ kind: "tag", tag: "work" })).resolves.toStrictEqual(["Filed"]);
      await expect(titlesOf({ folderId: projects, kind: "folder" })).resolves.toStrictEqual([
        "Filed",
      ]);
      await expect(titlesOf({ kind: "unsorted" })).resolves.toStrictEqual(["Loose"]);
    });
  });

  it("searches the side its scope lists, ranked, each item with the passage that matched", async () => {
    await inCell(cellOf(), async (state) => {
      const { clock, engine, library } = laptopIn(state);
      const gone = await library.items.createNote({ markdown: "A fox long gone." });
      clock.now += 60_000;
      engine.runDueJobs(() => {});
      await library.items.delete({ ids: [gone.item.id] });
      // typed a moment ago, so the index has not taken it in: its exact text finds it
      const kept = await library.items.createNote({ markdown: "The fox naps in the sun." });
      await library.items.createNote({ markdown: "The dog barks." });

      const live = await library.listing.page({ limit: 10, scope: { kind: "all" }, words: "fox" });
      expect(live.items.map(({ id }) => id)).toStrictEqual([kept.item.id]);
      expect(live.items[0]?.snippet).toContain("fox");

      const deleted = await library.listing.page({
        limit: 10,
        scope: { kind: "deleted" },
        words: "fox",
      });
      expect(deleted.items.map(({ id }) => id)).toStrictEqual([gone.item.id]);
    });
  });

  it("counts the rail: folders in rail order, each tag once under its spelling", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = laptopIn(state);
      const [early, late] = ["a0", "a1"];
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
      const { library } = laptopIn(state);
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

  it("lists what a change set did as it lands, once it seals and once it is undone", async () => {
    await inCell(cellOf(), async (state) => {
      const { clock, engine, library } = laptopIn(state);
      const titles = async () => {
        const page = await library.listing.page({ ...BY_TITLE, limit: 10 });
        return page.items.map(({ card }) => card.title);
      };
      const seal = () => {
        clock.now += 60_000;
        engine.runDueJobs(() => {});
      };
      const apple = await library.items.createNote({ markdown: "Apple.", title: "Apple" });
      seal();
      await expect(titles()).resolves.toStrictEqual(["Apple"]);

      await library.items.createNote({ markdown: "Banana.", title: "Banana" });
      await library.items.organize({ addTags: ["fruit"], ids: [apple.item.id] });
      await expect(titles()).resolves.toStrictEqual(["Apple", "Banana"]);
      seal();
      const history = await library.history.list({});
      const [sealed] = history.changeSets;
      expect(sealed?.closedAt).not.toBeNull();
      await expect(titles()).resolves.toStrictEqual(["Apple", "Banana"]);
      await expect(library.listing.scopes()).resolves.toMatchObject({
        tags: [{ items: 1, tag: "fruit" }],
        total: 2,
      });

      await library.history.undo({ changeSetIds: [sealed?.id ?? ""] });
      await expect(titles()).resolves.toStrictEqual(["Apple"]);
      // the listing this cell kept answers as one read whole from its rows
      await expect(library.listing.scopes()).resolves.toStrictEqual(
        await laptopIn(state).library.listing.scopes(),
      );
    });
  });

  it("answers a folder write with each folder it changed, as the write left it", async () => {
    await inCell(cellOf(), async (state) => {
      const { library } = laptopIn(state);
      const first = "a0";
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
