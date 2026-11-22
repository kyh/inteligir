import { bytesFolderPath } from "@repo/contract/items/item-kind";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items.test-utils";
import { BlobReader, TextWriter, ZipReader } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";

import type { ExportCell, WholeItem } from "./export-cell";
import type { ExportNews } from "./export-news";
import { EXPORT_INTERRUPTED, exportLibrary } from "./export-writing";

const PICTURE = "a".repeat(64);
const NOTES_FILE = "b".repeat(64);
const REPORT = "c".repeat(64);

const PROJECTS = "0195f3a0-5c1e-7000-8000-0000000000f1";
const Q4 = "0195f3a0-5c1e-7000-8000-0000000000f2";

const PLAN = "0195f3a0-5c1e-7000-8000-000000000001";
const IDEAS = "0195f3a0-5c1e-7000-8000-000000000002";
const DELETED = "0195f3a0-5c1e-7000-8000-000000000003";
const PURGED = "0195f3a0-5c1e-7000-8000-000000000004";
const DECK = "0195f3a0-5c1e-7000-8000-000000000005";

const note = (blocks: readonly BodyBlock["block"][]) =>
  blocks.map((block) => ({ block, section: "note" })) satisfies BodyBlock[];

const picture: BodyBlock["block"] = {
  children: [{ text: "" }],
  id: "pic",
  sha: PICTURE,
  type: "img",
};

const notesFile: BodyBlock["block"] = {
  children: [{ text: "" }],
  id: "notes",
  name: "notes.txt",
  sha: NOTES_FILE,
  type: "file",
};

const item = (id: string, fields: Partial<LibraryItemFields>, blocks: BodyBlock[] = []) =>
  ({
    blocks,
    fields: noteFixture(fields),
    id,
  }) satisfies WholeItem;

const LIBRARY: readonly WholeItem[] = [
  item(PLAN, { parentId: Q4, title: "Launch plan" }, [
    ...note([
      {
        children: [
          { text: "See " },
          { children: [{ text: "" }], key: IDEAS, type: "mention", value: "Ideas" },
          { text: "." },
        ],
        id: "p1",
        type: "p",
      },
      picture,
      notesFile,
    ]),
  ]),
  item(
    IDEAS,
    { title: "Ideas" },
    note([paragraph("p2", "Some ideas."), { ...picture, id: "pic2" }]),
  ),
  item(DELETED, { deletedAt: 1_700_000_000_000, title: "Gone since" }),
  item(PURGED, { title: "Purged since" }),
  item(DECK, { kind: "pdf", originalName: "deck.pdf", originalSha: REPORT, title: "Deck" }),
];

const FILES = new Map([
  [PICTURE, new Blob(["png bytes"], { type: "image/png" })],
  [NOTES_FILE, new Blob(["plain words"], { type: "text/plain" })],
]);

const fakeCell = (options: { readonly failOn?: string } = {}) => {
  const reads = new Map<string, number>();
  const pages = [LIBRARY.slice(0, 2), LIBRARY.slice(1)];

  const cell: ExportCell = {
    file: async (sha) => {
      reads.set(sha, (reads.get(sha) ?? 0) + 1);

      return await Promise.resolve(FILES.get(sha) ?? null);
    },
    folders: async () =>
      await Promise.resolve([
        { id: PROJECTS, parentId: null, title: "Projects" },
        { id: Q4, parentId: PROJECTS, title: "Q4" },
      ]),
    item: async (id) => {
      if (id === options.failOn) {
        throw new Error("no answer");
      }

      return await Promise.resolve(
        id === PURGED ? null : (LIBRARY.find((one) => one.id === id) ?? null),
      );
    },
    listed: async (cursor) =>
      await Promise.resolve({
        cursor: cursor === 0 ? 1 : null,
        items: (pages[cursor] ?? []).map(({ fields, id }) => ({
          fields: { ...fields, deletedAt: null },
          id,
        })),
      }),
  };

  return { cell, reads };
};

const run = async (cell: ExportCell) => {
  const told: ExportNews[] = [];
  await exportLibrary({ kind: "download" }, cell, (news) => {
    told.push(news);
  });

  return told;
};

const entriesOf = async (zip: Blob) => {
  const entries = await new ZipReader(new BlobReader(zip)).getEntries();
  const texts = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.directory) {
      texts.set(entry.filename, await entry.getData(new TextWriter()));
    }
  }

  return texts satisfies ReadonlyMap<string, string>;
};

describe(exportLibrary, () => {
  it("writes every live item and the files it holds once, filed under its folders, as it tells", async () => {
    const { cell, reads } = fakeCell();
    const told = await run(cell);
    const done = told.at(-1);

    if (done?.kind !== "done" || done.zip === null) {
      throw new Error(`the export ended ${JSON.stringify(done)}`);
    }

    expect(done.counts).toStrictEqual({ filesMissing: 1, items: 3, propertiesLeftOut: 0 });
    expect(told.slice(0, -1)).toStrictEqual([
      { kind: "listing" },
      { kind: "writing", total: 5, written: 0 },
      { kind: "writing", total: 5, written: 1 },
      { kind: "writing", total: 5, written: 2 },
      { kind: "writing", total: 5, written: 3 },
    ]);
    expect(done.zip.type).toBe("application/zip");
    const entries = await entriesOf(done.zip);
    expect([...entries.keys()].toSorted()).toStrictEqual(
      [
        "Projects/Q4/Launch plan.md",
        bytesFolderPath(PICTURE, "Image.png"),
        bytesFolderPath(NOTES_FILE, "notes.txt"),
        "Ideas.md",
        "Deck.md",
      ].toSorted(),
    );
    expect(entries.get("Projects/Q4/Launch plan.md")).toContain(`(mention:${IDEAS})`);
    expect(entries.get(bytesFolderPath(NOTES_FILE, "notes.txt"))).toBe("plain words");
    expect(Object.fromEntries(reads)).toStrictEqual({ [NOTES_FILE]: 1, [PICTURE]: 1, [REPORT]: 1 });
  });

  it("files an item under a note in the note's own folder, so a note's children keep their nesting", async () => {
    const trip = "0195f3a0-5c1e-7000-8000-000000000011";
    const day = "0195f3a0-5c1e-7000-8000-000000000012";

    const held = [
      item(trip, { parentId: PROJECTS, title: "Trip" }),
      item(day, { parentId: trip, title: "Day one" }),
    ];

    const cell: ExportCell = {
      file: async () => await Promise.resolve(null),
      folders: async () =>
        await Promise.resolve([{ id: PROJECTS, parentId: null, title: "Projects" }]),
      item: async (id) => await Promise.resolve(held.find((one) => one.id === id) ?? null),
      listed: async () =>
        await Promise.resolve({
          cursor: null,
          items: held.map(({ fields, id }) => ({ fields, id })),
        }),
    };

    const told = await run(cell);
    const done = told.at(-1);

    if (done?.kind !== "done" || done.zip === null) {
      throw new Error(`the export ended ${JSON.stringify(done)}`);
    }

    const entries = await entriesOf(done.zip);

    expect([...entries.keys()].toSorted()).toStrictEqual([
      "Projects/Trip.md",
      "Projects/Trip/Day one.md",
    ]);
  });

  it("says it stopped short when the library can't be read to the end", async () => {
    const told = await run(fakeCell({ failOn: DECK }).cell);
    expect(told.at(-1)).toStrictEqual({
      counts: { filesMissing: 0, items: 2, propertiesLeftOut: 0 },
      kind: "failed",
      message: EXPORT_INTERRUPTED,
    });
  });
});
