import { setTimeout as delay } from "node:timers/promises";

import { urlKey } from "@repo/contract/items/item-url";
import { fileSha } from "@repo/contract/library/file-sha";
import { BlobWriter, Uint8ArrayReader, ZipWriter } from "@zip.js/zip.js/lib/zip-core-native.js";
import { describe, expect, it } from "vitest";

import { RAINDROP_EXPORT } from "../test-support/raindrop-export";
import { ImportStoppedError, LIBRARY_FULL } from "./import-landing";
import type { ImportCell, ImportedItem } from "./import-landing";
import type { ImportNews } from "./import-news";
import { readImport } from "./import-reading";
import { NOT_A_ZIP, PATHS_AT_ONCE } from "./markdown-import";

const encoder = new TextEncoder();

type NewItem = Extract<ImportedItem, { kind: "new" }>;

// the library as the cell answers an import, in memory: an item by its id or its address, and a
// file named once an item's text carries its sha
const fakeCell = (options: { readonly roomFor?: number } = {}) => {
  const items = new Map<string, NewItem>();
  const files = new Set<string>();
  const batches: number[] = [];
  const holder = (url: string | null): NewItem | undefined => {
    const key = url === null ? null : urlKey(url);
    return [...items.values()].find(
      (item) => key !== null && item.fields.url !== null && urlKey(item.fields.url) === key,
    );
  };
  const cell: ImportCell = {
    keep: async (bytes) => {
      files.add(fileSha(bytes));
      return await Promise.resolve(fileSha(bytes));
    },
    land: async (batch) => {
      batches.push(batch.length);
      const counts = { added: 0, alreadySaved: 0, unreadable: 0 };
      for (const item of batch) {
        if (item.kind === "restore") {
          counts.alreadySaved += 1;
        } else if (items.has(item.id) || holder(item.fields.url) !== undefined) {
          counts.alreadySaved += 1;
        } else if (items.size >= (options.roomFor ?? Number.POSITIVE_INFINITY)) {
          throw new ImportStoppedError(LIBRARY_FULL);
        } else {
          items.set(item.id, item);
          counts.added += 1;
        }
      }
      return await Promise.resolve(counts);
    },
    named: async (shas) => {
      const texts = [...items.values()].map((item) => JSON.stringify(item));
      return await Promise.resolve({
        named: shas.filter((sha) => texts.some((text) => text.includes(sha))),
        originals: shas.filter((sha) =>
          [...items.values()].some((item) => item.fields.originalSha === sha),
        ),
      });
    },
    settle: async (notes) =>
      await Promise.resolve(
        notes.map((note) => {
          const held = items.get(note.id) ?? holder(note.url);
          return held === undefined
            ? { id: note.id, standing: "new" as const }
            : { id: held.id, standing: "held" as const };
        }),
      ),
  };
  return { batches, cell, files, items };
};

const zipOf = async (entries: Readonly<Record<string, Uint8Array>>): Promise<Blob> => {
  const writer = new ZipWriter(new BlobWriter("application/zip"));
  for (const [path, bytes] of Object.entries(entries)) {
    await writer.add(path, new Uint8ArrayReader(bytes));
  }
  return await writer.close();
};

const read = async (cell: ImportCell, file: Blob, source: "markdown" | "raindrop") => {
  const news: ImportNews[] = [];
  await readImport({ file, source }, cell, (heard) => {
    news.push(heard);
  });
  return news.at(-1);
};

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

const VAULT = {
  ".obsidian/app.json": encoder.encode("{}"),
  "Attachments/lone.pdf": encoder.encode("%PDF-1.7\n% a file no note embeds\n"),
  "Beta.md": encoder.encode("Beta's own words.\n"),
  "Notes/Alpha.md": encoder.encode(
    "---\ntags: [project]\n---\n# Alpha\n\nSee [[Beta]] and ![[pic.png]].\n",
  ),
  "pic.png": PNG,
};

const titled = (items: ReadonlyMap<string, NewItem>, title: string): NewItem => {
  const item = [...items.values()].find((candidate) => candidate.fields.title === title);
  if (item === undefined) {
    throw new Error(`no item titled ${title}`);
  }
  return item;
};

// the cell's keep made slow, a later file sooner, refusing every file past `roomFor` as a full
// library does, and what it saw: the most keeps under way at once, and any asked after a refusal
const slowKeeps = (cell: ImportCell, roomFor = Number.POSITIVE_INFINITY) => {
  const seen = { afterRefusal: 0, calls: 0, mostAtOnce: 0 };
  let underWay = 0;
  let refused = false;
  const slow: ImportCell = {
    ...cell,
    keep: async (bytes, mime) => {
      seen.calls += 1;
      const call = seen.calls;
      if (refused) {
        seen.afterRefusal += 1;
      }
      if (call > roomFor) {
        refused = true;
        throw new ImportStoppedError(LIBRARY_FULL);
      }
      underWay += 1;
      seen.mostAtOnce = Math.max(seen.mostAtOnce, underWay);
      await delay(Math.max(1, 30 - call * 2));
      underWay -= 1;
      return await cell.keep(bytes, mime);
    },
  };
  return { cell: slow, seen };
};

const lonePdfs = (count: number): Record<string, Uint8Array> =>
  Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `Files/f${String(index).padStart(2, "0")}.pdf`,
      encoder.encode(`%PDF-1.7\n% file ${String(index)}\n`),
    ]),
  );

describe("a zip of notes read on the device", () => {
  it("lands a vault's notes, their links and files, and its folders", async () => {
    const library = fakeCell();
    const ended = await read(library.cell, await zipOf(VAULT), "markdown");
    expect(ended).toStrictEqual({
      counts: { added: 3, alreadySaved: 0, unreadable: 0 },
      kind: "done",
    });
    const alpha = titled(library.items, "Alpha");
    const beta = titled(library.items, "Beta");
    expect(alpha).toMatchObject({ fields: { tags: ["project"] }, folder: "Notes" });
    const alphaText = JSON.stringify(alpha.blocks);
    expect(alphaText).toContain(beta.id);
    expect(alphaText).toContain(fileSha(PNG));
    expect(titled(library.items, "lone")).toMatchObject({
      fields: { kind: "pdf" },
      folder: "Attachments",
    });
    expect(library.files.size).toBe(2);
  });

  it("lands nothing twice when the same zip is read again", async () => {
    const library = fakeCell();
    const zip = await zipOf(VAULT);
    await read(library.cell, zip, "markdown");
    const ids = [...library.items.keys()];
    // the notes are held, and the file is no item's of its own again, since one holds it
    expect(await read(library.cell, zip, "markdown")).toStrictEqual({
      counts: { added: 0, alreadySaved: 2, unreadable: 0 },
      kind: "done",
    });
    expect([...library.items.keys()]).toStrictEqual(ids);
  });

  it("counts a note too long to read, and lands the rest", async () => {
    const library = fakeCell();
    const long = `# Long\n\n${"A line of plain words in a long note.\n\n".repeat(30_000)}`;
    const ended = await read(
      library.cell,
      await zipOf({ "Long.md": encoder.encode(long), "Short.md": encoder.encode("Short.\n") }),
      "markdown",
    );
    expect(ended).toStrictEqual({
      counts: { added: 1, alreadySaved: 0, unreadable: 1 },
      kind: "done",
    });
  });

  it("keeps a few files at once, and lands them in the zip's order", async () => {
    const library = fakeCell();
    const slow = slowKeeps(library.cell);
    expect(await read(slow.cell, await zipOf(lonePdfs(10)), "markdown")).toStrictEqual({
      counts: { added: 10, alreadySaved: 0, unreadable: 0 },
      kind: "done",
    });
    expect(slow.seen.mostAtOnce).toBe(PATHS_AT_ONCE);
    expect([...library.items.values()].map((item) => item.fields.title)).toStrictEqual(
      Array.from({ length: 10 }, (_, index) => `f${String(index).padStart(2, "0")}`),
    );
  });

  it("keeps no file after the library refuses one as full, and lands nothing", async () => {
    const library = fakeCell();
    const slow = slowKeeps(library.cell, 2);
    expect(await read(slow.cell, await zipOf(lonePdfs(10)), "markdown")).toMatchObject({
      kind: "failed",
      message: LIBRARY_FULL,
    });
    expect(slow.seen.afterRefusal).toBe(0);
    expect(slow.seen.calls).toBeLessThanOrEqual(2 + PATHS_AT_ONCE);
    expect(library.items.size).toBe(0);
  });

  it("stops on a file that is no zip, saying how", async () => {
    const ended = await read(fakeCell().cell, new Blob(["not a zip"]), "markdown");
    expect(ended).toStrictEqual({
      counts: { added: 0, alreadySaved: 0, unreadable: 0 },
      kind: "failed",
      message: NOT_A_ZIP,
    });
  });
});

describe("a Raindrop export read on the device", () => {
  it("lands every bookmark as an unread link, filed as Raindrop filed it", async () => {
    const library = fakeCell();
    const ended = await read(library.cell, new Blob([RAINDROP_EXPORT]), "raindrop");
    expect(ended).toStrictEqual({
      counts: { added: 6, alreadySaved: 1, unreadable: 0 },
      kind: "done",
    });
    expect(titled(library.items, "Pasta al limone")).toMatchObject({
      fields: { reading: { at: null, state: "pending" }, tags: ["recipes", "Quick-Meals"] },
      folder: "Cooking/Weeknight",
    });
  });

  it("lands a hundred bookmarks a call at most", async () => {
    const library = fakeCell();
    const rows = Array.from({ length: 250 }, (_, index) => `https://a.example/${String(index)}`);
    await read(library.cell, new Blob([["url", ...rows].join("\n")]), "raindrop");
    expect(library.batches).toStrictEqual([100, 100, 50]);
  });

  it("stops once the library is full, keeping what it added", async () => {
    const library = fakeCell({ roomFor: 2 });
    const ended = await read(library.cell, new Blob([RAINDROP_EXPORT]), "raindrop");
    expect(ended).toMatchObject({ kind: "failed", message: LIBRARY_FULL });
    expect(library.items.size).toBe(2);
  });
});
