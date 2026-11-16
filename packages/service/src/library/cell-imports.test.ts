// An import as the cell takes it from the device that reads the file: how each note it planned
// stands, which of its files the library's items name, and its items landed a batch at a time, an
// item a rule refuses counted while the rest land, and a full library refusing the batch.

import { blankItemFields } from "@repo/contract/library/item-makes";
import type { ImportedFields } from "@repo/editor/codec/item-markdown";
import { paragraph } from "@repo/contract/test-support/library-items";
import { describe, expect, it } from "vitest";

import { pngOf } from "../fill/test-support/fill-cell";
import { cellIn, cellOf, clockAt, inCell } from "../test-support/library-cell";
import { uploadedFile } from "../test-support/library-files";

type Cell = ReturnType<typeof cellIn> & { readonly state: DurableObjectState };

const inLibrary = async <T>(
  run: (cell: Cell) => Promise<T>,
  options: { readonly bytesCap?: number } = {},
): Promise<T> =>
  await inCell(cellOf(), async (state) => {
    const cell = cellIn(state, { bytesCap: options.bytesCap, clock: clockAt(Date.now()) });
    return await run({ ...cell, state });
  });

const fieldsOf = (title: string, url: string | null = null): ImportedFields => {
  const blank = blankItemFields(Date.UTC(2026, 9, 1));
  return {
    aliases: blank.aliases,
    author: blank.author,
    coverSha: blank.coverSha,
    description: blank.description,
    fetchError: blank.fetchError,
    fetchState: blank.fetchState,
    fetchedAt: blank.fetchedAt,
    kind: blank.kind,
    lang: blank.lang,
    originalName: blank.originalName,
    originalSha: blank.originalSha,
    pinnedAt: blank.pinnedAt,
    properties: blank.properties,
    published: blank.published,
    savedAt: blank.savedAt,
    site: blank.site,
    tags: blank.tags,
    title,
    url,
  };
};

const note = (
  cell: Cell,
  title: string,
  more: { readonly folder?: string; readonly url?: string; readonly id?: string } = {},
) => ({
  blocks: [
    { block: paragraph(cell.library.ids.block(), `${title}'s words.`), section: "note" as const },
  ],
  cover: null,
  fields: fieldsOf(title, more.url ?? null),
  folder: more.folder ?? null,
  id: more.id ?? cell.library.ids.item(),
  kind: "new" as const,
});

const land = async (cell: Cell, items: Parameters<Cell["client"]["imports"]["land"]>[0]["items"]) =>
  await cell.client.imports.land({ items });

const titles = ({ state }: Cell): unknown[] =>
  state.storage.sql
    .exec("SELECT title FROM items WHERE deleted_at IS NULL ORDER BY title")
    .toArray()
    .map((row) => row.title);

describe("how an import's notes stand", () => {
  it("answers a note the library holds by its id or its address, one in Deleted, and one new", async () => {
    await inLibrary(async (cell) => {
      const { client } = cell;
      const held = note(cell, "Held");
      const deleted = note(cell, "Deleted");
      await land(cell, [held, deleted, note(cell, "Linked", { url: "https://a.example/page" })]);
      await client.items.delete({ ids: [deleted.id] });
      const fresh = cell.library.ids.item();
      const { notes } = await client.imports.settle({
        notes: [
          { id: held.id, url: null },
          { id: deleted.id, url: null },
          { id: fresh, url: "https://a.example/page?utm_source=x" },
          { id: cell.library.ids.item(), url: null },
        ],
      });
      expect(notes.slice(0, 2)).toStrictEqual([
        { id: held.id, standing: "held" },
        { id: deleted.id, standing: "deleted" },
      ]);
      expect(notes[2]).toMatchObject({ standing: "held" });
      expect(notes[2]?.id).not.toBe(fresh);
      expect(notes[3]).toMatchObject({ standing: "new" });
    });
  });

  it("gives a note whose id a purged item kept a fresh one", async () => {
    await inLibrary(async (cell) => {
      const { client } = cell;
      const gone = note(cell, "Gone");
      await land(cell, [gone]);
      await client.items.delete({ ids: [gone.id] });
      await client.items.purge({ ids: [gone.id] });
      const { notes } = await client.imports.settle({ notes: [{ id: gone.id, url: null }] });
      expect(notes[0]?.standing).toBe("new");
      expect(notes[0]?.id).not.toBe(gone.id);
    });
  });
});

describe("an import's batch", () => {
  it("lands every item it adds, keeping no change set, in the folders its paths name", async () => {
    await inLibrary(async (cell) => {
      const { state } = cell;
      for (const title of ["Alpha", "Beta"]) {
        await land(cell, [note(cell, title, { folder: "Projects/Specs" })]);
      }
      expect(titles(cell)).toStrictEqual(["Alpha", "Beta"]);
      expect(state.storage.sql.exec("SELECT id FROM change_sets").toArray()).toStrictEqual([]);
      expect(
        state.storage.sql
          .exec("SELECT name FROM folders ORDER BY name")
          .toArray()
          .map((row) => row.name),
      ).toStrictEqual(["Projects", "Specs"]);
    });
  });

  it("counts an item it holds by id or address, and brings one back from Deleted", async () => {
    await inLibrary(async (cell) => {
      const { client } = cell;
      const held = note(cell, "Held", { url: "https://a.example/held" });
      const deleted = note(cell, "Deleted");
      await land(cell, [held, deleted]);
      await client.items.delete({ ids: [deleted.id] });
      await expect(
        land(cell, [
          held,
          note(cell, "Same page", { url: "https://a.example/held" }),
          { id: deleted.id, kind: "restore" },
        ]),
      ).resolves.toStrictEqual({ added: 1, alreadySaved: 2, unreadable: 0 });
      expect(titles(cell)).toStrictEqual(["Deleted", "Held"]);
    });
  });

  it("counts an item a rule refuses as unreadable, and lands the rest", async () => {
    await inLibrary(async (cell) => {
      const refused = note(cell, "Refused");
      await expect(
        land(cell, [
          { ...refused, fields: { ...refused.fields, coverSha: "a".repeat(64) } },
          note(cell, "Kept"),
        ]),
      ).resolves.toStrictEqual({ added: 1, alreadySaved: 0, unreadable: 1 });
      expect(titles(cell)).toStrictEqual(["Kept"]);
    });
  });

  it("refuses the whole batch once the library is full, landing none of it", async () => {
    await inCell(cellOf(), async (state) => {
      const roomy = { ...cellIn(state), state };
      await land(roomy, [note(roomy, "Before")]);
      const cell = {
        ...cellIn(state, { bytesCap: state.storage.sql.databaseSize + 1024 }),
        state,
      };
      const long = note(cell, "Long");
      await expect(
        land(cell, [
          note(cell, "Small"),
          {
            ...long,
            blocks: [{ block: paragraph("long", "y".repeat(8 * 1024)), section: "note" }],
          },
        ]),
      ).rejects.toMatchObject({ code: "QUOTA" });
      expect(titles(cell)).toStrictEqual(["Before"]);
    });
  });
});

describe("the files an import's items name", () => {
  it("answers which a live item names, and which one holds as its own original", async () => {
    await inLibrary(async (cell) => {
      const { client, library, accountId } = cell;
      const named = await uploadedFile(library, accountId, {
        bytes: pngOf(400, 300),
        mime: "image/png",
      });
      const original = await uploadedFile(library, accountId, {
        bytes: pngOf(300, 200),
        mime: "image/png",
      });
      const loose = await uploadedFile(library, accountId, {
        bytes: pngOf(200, 100),
        mime: "image/png",
      });
      const covered = note(cell, "Covered");
      await land(cell, [
        { ...covered, fields: { ...covered.fields, coverSha: named } },
        {
          ...note(cell, "picture"),
          blocks: [],
          fields: {
            ...fieldsOf("picture"),
            kind: "image",
            originalName: "picture.png",
            originalSha: original,
          },
        },
      ]);
      const answer = await client.imports.named({ shas: [named, original, loose] });
      expect(new Set(answer.named)).toStrictEqual(new Set([named, original]));
      expect(answer.originals).toStrictEqual([original]);
    });
  });
});
