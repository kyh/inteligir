// What a client's suites read of the fake cell, each case the one the cell's own suite holds the
// Worker to (`packages/service/src/library/cell-listing.test.ts`): an item whole, a listing's pages,
// the rail's counts and every title.

import { describe, expect, it } from "vitest";

import { ordsBetween } from "../library/block-order";
import { isOrpcError } from "../v1-errors";
import { createFakeCell } from "./fake-cell";
import { paragraph } from "./library-items";

const idOf = (n: number): string => `0190a000-0000-7000-8000-${n.toString(16).padStart(12, "0")}`;

const LIVE = { deleted: false, sort: "title" } as const;

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

// a cell, a laptop's client on it, and a note the laptop makes of lines of text
const laptop = () => {
  const cell = createFakeCell();
  const { library } = cell.device("laptop").client;
  let next = 0;
  const newId = (): string => {
    next += 1;
    return idOf(next);
  };
  const note = async (
    lines: readonly string[],
    filing: {
      readonly title?: string;
      readonly tags?: readonly string[];
      readonly folderId?: string;
    } = {},
  ): Promise<string> => {
    const id = newId();
    const ords = ordsBetween(null, null, lines.length);
    await library.items.create({
      blocks: lines.map((text, at) => ({
        block: paragraph(`${id}-${String(at)}`, text),
        ord: ords[at] ?? "a0",
        section: "note",
      })),
      folderId: filing.folderId ?? null,
      id,
      savedAt: 1_700_000_000_000 + next,
      tags: [...(filing.tags ?? [])],
      title: filing.title ?? "",
    });
    return id;
  };
  return { library, newId, note };
};

describe("what a client reads of the fake cell", () => {
  it("answers an item whole in reading order, one in Deleted too, and none it lacks", async () => {
    const { library, newId } = laptop();
    const id = newId();
    const [early = "a0", late = "a1"] = ordsBetween(null, null, 2);
    await library.items.create({
      blocks: [
        { block: paragraph("second", "Second line."), ord: late, section: "note" },
        { block: paragraph("first", "First line."), ord: early, section: "note" },
      ],
      folderId: null,
      id,
      savedAt: 1_700_000_000_000,
      tags: [],
      title: "Two lines",
    });
    const whole = await library.items.get({ id });
    expect(whole).toMatchObject({ fields: { kind: "note", title: "Two lines" }, id });
    expect(whole.blocks.map(({ block }) => block.id)).toStrictEqual(["first", "second"]);
    expect(whole.seq).toBeGreaterThan(0);

    await library.items.delete({ ids: [id] });
    await expect(library.items.get({ id })).resolves.toMatchObject({
      fields: { deletedAt: expect.any(Number) },
    });
    await expect(codeOf(library.items.get({ id: newId() }))).resolves.toBe("NOT_FOUND");
  });

  it("pages a listing from where the last page ended, counting each kind", async () => {
    const { library, newId, note } = laptop();
    for (const title of ["Cherry", "Apple", "Banana"]) {
      await note([`${title}.`], { title });
    }
    await library.items.saveLink({ id: newId(), url: "https://example.com/durian" });

    const first = await library.listing.page({ limit: 2, query: { ...LIVE, kinds: ["note"] } });
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

  it("lists a tag with the tags under it, a folder with its subfolders, and Unsorted", async () => {
    const { library, newId, note } = laptop();
    const [first = "a0"] = ordsBetween(null, null, 1);
    const projects = newId();
    const garden = newId();
    await library.folders.write({
      ops: [
        { id: projects, name: "Projects", op: "create", parentId: null, sort: first },
        { id: garden, name: "Garden", op: "create", parentId: projects, sort: first },
      ],
    });
    await note(["Filed."], { folderId: garden, tags: ["work/garden"], title: "Filed" });
    await note(["Loose."], { tags: ["working"], title: "Loose" });

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

  it("lists every tag an item carries, its field's and its body's, each spelling once", async () => {
    const { library, note } = laptop();
    const id = await note(["Weeding the #garden, #garden again."], { tags: ["Work"] });
    const page = await library.listing.page({ limit: 10, query: LIVE });
    expect(page.items).toMatchObject([{ id, tags: ["Work", "garden"] }]);
  });

  it("searches the side its query lists, each item with the passage that matched", async () => {
    const { library, note } = laptop();
    const gone = await note(["A fox long gone."]);
    await library.items.delete({ ids: [gone] });
    const kept = await note(["The fox naps in the sun."]);
    await note(["The dog barks."]);

    const live = await library.listing.page({
      limit: 10,
      query: { deleted: false, sort: "relevance" },
      words: "FOX",
    });
    expect(live.items.map(({ id }) => id)).toStrictEqual([kept]);
    expect(live.items[0]?.snippet).toContain("fox");

    const deleted = await library.listing.page({
      limit: 10,
      query: { deleted: true, sort: "relevance" },
      words: "fox",
    });
    expect(deleted.items.map(({ id }) => id)).toStrictEqual([gone]);
  });

  it("counts the rail: folders in rail order, each tag once under its spelling", async () => {
    const { library, newId, note } = laptop();
    const [early = "a0", late = "a1"] = ordsBetween(null, null, 2);
    const projects = newId();
    const garden = newId();
    const archive = newId();
    const gone = newId();
    await library.folders.write({
      ops: [
        { id: projects, name: "Projects", op: "create", parentId: null, sort: late },
        { id: garden, name: "Garden", op: "create", parentId: projects, sort: early },
        { id: archive, name: "Archive", op: "create", parentId: null, sort: early },
        { id: gone, name: "Gone", op: "create", parentId: null, sort: early },
      ],
    });
    await library.folders.write({ ops: [{ id: gone, op: "delete" }] });
    await note(["One."], { folderId: garden, tags: ["Work"] });
    await note(["Two."], { tags: ["Work", "home"] });
    const three = await note(["Three."]);
    await library.items.delete({ ids: [three] });

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

  it("titles every item in the library as its card names it, and none in Deleted", async () => {
    const { library, note } = laptop();
    const beta = await note(["B."], { title: "Beta" });
    const alpha = await note(["A."], { title: "alpha" });
    const untitled = await note(["Groceries", "Milk."]);
    const gone = await note(["G."], { title: "Gone" });
    await library.items.delete({ ids: [gone] });
    await expect(library.listing.titles()).resolves.toStrictEqual({
      targets: [
        { id: alpha, title: "alpha" },
        { id: beta, title: "Beta" },
        { id: untitled, title: "Groceries" },
      ],
    });
  });
});
