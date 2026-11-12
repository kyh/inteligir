// What a client's suites read of the fake cell, each case the one the cell's own suite holds the
// Worker to (`packages/service/src/library/cell-listing.test.ts`): an item whole, its tags and a
// search; then the writes a screen makes beyond its own ops, and the rows a suite seeds and reads
// back. The listing's pages, the rail's counts and every title are `library-index.ts`'s, which
// both answer by.

import { describe, expect, it } from "vitest";

import { newIdSchema } from "../library/library-wire";
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
    await library.items.create({
      blocks: lines.map((text, at) => ({
        block: paragraph(`${id}-${String(at)}`, text),
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
    await library.items.create({
      blocks: [
        { block: paragraph("first", "First line."), section: "note" },
        { block: paragraph("second", "Second line."), section: "note" },
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
});

describe("what a screen writes of the fake cell beyond its ops", () => {
  it("mints an id as a device does for a link saved without one", async () => {
    const { library } = laptop();
    const { created, item } = await library.items.saveLink({ url: "https://example.com/a" });
    expect(created).toBe(true);
    expect(newIdSchema.safeParse(item.id).success).toBe(true);
    const again = await library.items.saveLink({ url: "https://example.com/b" });
    expect(again.item.id).not.toBe(item.id);
  });

  it("organizes as the cell does: tags case by case, a folder by its id, a pin and a title", async () => {
    const { library, newId, note } = laptop();
    const reading = newId();
    await library.folders.write({
      ops: [{ id: reading, name: "Reading", op: "create", parentId: null, sort: "a0" }],
    });
    const id = await note(["Plans."], { tags: ["Spring", "trips"], title: "Plans" });

    const { items } = await library.items.organize({
      addTags: ["SPRING", "plans"],
      folder: { id: reading },
      ids: [id],
      pinned: true,
      removeTags: ["TRIPS"],
      title: "Trip",
    });

    expect(items).toMatchObject([
      { folderId: reading, id, pinned: true, tags: ["Spring", "plans"], title: "Trip" },
    ]);
    await expect(library.items.get({ id })).resolves.toMatchObject({
      fields: { folderId: reading, tags: ["Spring", "plans"], title: "Trip" },
    });
  });

  it("refuses an organize naming an item or a folder it lacks, landing none of it", async () => {
    const { library, newId, note } = laptop();
    const id = await note(["Kept."], { title: "Kept" });

    await expect(
      codeOf(library.items.organize({ ids: [id, newId()], pinned: true })),
    ).resolves.toBe("NOT_FOUND");
    await expect(
      codeOf(library.items.organize({ folder: { id: newId() }, ids: [id] })),
    ).resolves.toBe("NOT_FOUND");
    await expect(library.items.get({ id })).resolves.toMatchObject({
      fields: { folderId: null, pinnedAt: null },
    });
  });

  it("empties Deleted for good, and counts any other id missing", async () => {
    const { library, newId, note } = laptop();
    const gone = await note(["Gone."]);
    const kept = await note(["Kept."]);
    await library.items.delete({ ids: [gone] });
    const stranger = newId();

    await expect(library.items.purge({ ids: [gone, kept, stranger] })).resolves.toStrictEqual({
      missing: [kept, stranger],
      purged: [gone],
    });
    await expect(codeOf(library.items.get({ id: gone }))).resolves.toBe("NOT_FOUND");
    await expect(library.listing.scopes()).resolves.toMatchObject({ deleted: 0, total: 1 });
  });

  it("reads a link's page again, and has no page to read for a note", async () => {
    const { library, note } = laptop();
    const { item } = await library.items.saveLink({ url: "https://example.com/page" });
    const id = await note(["Mine."]);

    await expect(library.items.refresh({ id: item.id })).resolves.toMatchObject({
      item: { fields: { fetchError: null, fetchState: "pending" }, id: item.id },
    });
    await expect(codeOf(library.items.refresh({ id }))).resolves.toBe("NOT_FOUND");
  });
});

describe("the rows a suite seeds in the fake cell", () => {
  it("lands each without a call, and reads it back as the listing and items.get answer it", async () => {
    const cell = createFakeCell();
    const { library } = cell.device("laptop").client;
    const reading = cell.seed.folder("Reading");
    const id = cell.seed.item({ folderId: reading, tags: ["spring"], title: "Plans" });
    const gone = cell.seed.item({ deletedAt: 1 });

    const page = await library.listing.page({
      limit: 10,
      query: { deleted: false, sort: "saved" },
    });
    expect(page.items).toStrictEqual([cell.listed(id)]);
    await expect(library.items.get({ id })).resolves.toStrictEqual(cell.held(id));
    await expect(library.listing.scopes()).resolves.toMatchObject({
      deleted: 1,
      folders: [{ id: reading, items: 1, name: "Reading" }],
    });
    expect(cell.held(gone).fields.deletedAt).toBe(1);
    expect(cell.calls).toStrictEqual([
      "laptop library/listing/page",
      "laptop library/items/get",
      "laptop library/listing/scopes",
    ]);
  });
});
