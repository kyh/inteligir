import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";

import { items as itemRows } from "@repo/db/cell/schema";
import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { ITEM_FIELD_CAPS, libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import {
  linksTo,
  linksToUrl,
  literalMatches,
  nextHead,
  readItem,
  readLiveItem,
  readMeta,
  SEARCH_ROW_MAX_BYTES,
  searchLibrary,
  searchRowBytes,
  searchRowOf,
  readListingRows,
  storeItemRow,
  storeLinks,
  storeSearchRow,
  storeTags,
  storeTombstone,
  writeMeta,
} from "./library-queries";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { runPlan } from "./library-sql";
import type { SqlStatement } from "./library-sql";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";

import { cellOf, inCell } from "../test-support/library-cell";
import { readSeedBlocks, storeBodyText, storeSeed } from "./cell-body";
import { cellStorageOf } from "./cell-storage";
import type { CellStorage } from "./cell-storage";

const leaf: [{ text: "" }] = [{ text: "" }];

// a fresh cell's storage, every raw statement its plans run recorded; drizzle's go to the cell
// unrecorded, and the cell itself holds every statement to a Durable Object's limits
interface Library {
  readonly storage: CellStorage;
  readonly statements: SqlStatement[];
}

const inLibrary = async (work: (library: Library) => void): Promise<void> => {
  await inCell(cellOf(), (state) => {
    const storage = cellStorageOf(state.storage);
    const statements: SqlStatement[] = [];
    work({
      statements,
      storage: {
        ...storage,
        all: (sql, params) => {
          statements.push({ params, sql });
          return storage.all(sql, params);
        },
        run: (sql, params) => {
          statements.push({ params, sql });
          storage.run(sql, params);
        },
      },
    });
  });
};

// an item as the cell lays one: its fields, and its body as the seed it keeps
interface Laid {
  readonly fields: LibraryItemFields;
  readonly blocks: readonly BodyBlock[];
}

const itemOf = (
  blocks: readonly LibraryBlock[],
  fields: LibraryItemFields = noteFixture(),
): Laid => ({
  blocks: blocks.map((block) => ({ block, section: "note" })),
  fields,
});

// a row, then its seed and derived rows under it, as the cell lays an item; null when the row held
// is as new or newer
const offer = (storage: CellStorage, id: string, state: Laid, seq: number) =>
  storage.transaction(() => {
    const body = deriveBody(state.blocks);
    const derived = deriveItem(state.fields, body.digest);
    const landed = storeItemRow(storage.db, {
      body: { bytes: 0, digest: body.digest, home: "seed", version: 0 },
      card: derived.card,
      fields: state.fields,
      id,
      seq,
      updatedAt: 1_700_000_000_000 + seq,
      urlKey: derived.urlKey,
    });
    if (!landed) {
      return null;
    }
    storeSeed(storage.db, id, state.blocks);
    storeBodyText(storage.db, id, body.text);
    storeLinks(storage.db, id, body.links);
    storeTags(storage.db, id, derived.tags);
    runPlan(storage, storeSearchRow(id, { ...derived.search, body: body.text }));
    return derived;
  });

// an item's fields and seed as the cell holds them
const laidOf = (storage: CellStorage, id: string): Laid | null => {
  const item = readLiveItem(storage.db, id);
  return item === null ? null : { blocks: readSeedBlocks(storage.db, id), fields: item.fields };
};

const put = (storage: CellStorage, id: string, state: Laid, seq = 1) => {
  const derived = offer(storage, id, state, seq);
  if (derived === null) {
    throw new Error(`the row of ${id} at ${String(seq)} did not land`);
  }
  return derived;
};

// a page link is a mention of its item; one that reached no item is the words it was written in
const linkTo = (itemId: string | null, title: string): LibraryBlock => ({
  children:
    itemId === null
      ? [{ text: `see [[${title}]]` }]
      : [
          { text: "see " },
          { children: leaf, key: itemId, type: "mention", value: title },
          { text: "" },
        ],
  id: `to-${title.replaceAll(" ", "-")}`,
  type: "p",
});

describe("items", () => {
  it("stores an item whole and reads it back as written", async () => {
    await inLibrary(({ storage }) => {
      const state = itemOf(
        [paragraph("a", "first"), paragraph("b", "second")],
        noteFixture({ aliases: ["Alt"], properties: { rating: 4 }, tags: ["work"] }),
      );
      const derived = put(storage, "item-1", state);
      expect(readItem(storage.db, "item-1")).toStrictEqual({
        body: {
          bytes: 0,
          digest: deriveBody(state.blocks).digest,
          home: "seed",
          version: 0,
        },
        card: derived.card,
        fields: state.fields,
        id: "item-1",
        kind: "live",
        seq: 1,
        updatedAt: 1_700_000_000_001,
        urlKey: null,
      });
      expect(laidOf(storage, "item-1")).toStrictEqual(state);
    });
  });

  it("keeps the newer item whole when an older one arrives: row, body, links, tags and index", async () => {
    await inLibrary(({ storage }) => {
      const newer = itemOf(
        [linkTo("target", "Target"), paragraph("a", "newer words")],
        noteFixture({ tags: ["fresh"], title: "Newer" }),
      );
      put(storage, "item-1", newer, 5);
      const older = itemOf(
        [paragraph("a", "older words")],
        noteFixture({ tags: ["stale"], title: "Older" }),
      );
      expect(offer(storage, "item-1", older, 3)).toBeNull();
      expect(offer(storage, "item-1", older, 5)).toBeNull();
      expect(
        storeItemRow(storage.db, {
          body: { bytes: 0, digest: deriveBody(older.blocks).digest, home: "seed", version: 0 },
          card: deriveItem(older.fields, deriveBody(older.blocks).digest).card,
          fields: older.fields,
          id: "item-1",
          seq: 4,
          updatedAt: 1,
          urlKey: null,
        }),
      ).toBe(false);
      expect(laidOf(storage, "item-1")).toStrictEqual(newer);
      expect(runPlan(storage, searchLibrary("older", 10))).toStrictEqual([]);
      expect(runPlan(storage, searchLibrary("newer", 10)).map((hit) => hit.itemId)).toStrictEqual([
        "item-1",
      ]);
      expect(
        storage.all("SELECT tag, origin FROM item_tags WHERE item_id = ?", ["item-1"]),
      ).toStrictEqual([{ origin: "field", tag: "fresh" }]);
      expect(linksTo(storage.db, "target")).toStrictEqual(["item-1"]);
    });
  });

  it("reads every item that is not purged, by id", async () => {
    await inLibrary(({ storage }) => {
      put(storage, "b", itemOf([], noteFixture({ title: "B" })));
      put(storage, "a", itemOf([], noteFixture({ title: "A" })));
      put(storage, "c", itemOf([], noteFixture({ title: "C" })));
      storeTombstone(storage, { deletedAt: 7, id: "c", seq: 9, updatedAt: 8 });
      expect(readListingRows(storage.db).map((row) => row.id)).toStrictEqual(["a", "b"]);
    });
  });

  it("holds one live item per address", async () => {
    await inLibrary(({ storage }) => {
      const link = noteFixture({ kind: "link", url: "https://example.com/a" });
      put(storage, "first", itemOf([], link));
      expect(() =>
        put(storage, "second", itemOf([], { ...link, url: "https://www.example.com/a" })),
      ).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({ message: expect.stringMatching(/UNIQUE/u) }),
        }),
      );
      put(storage, "first", itemOf([], { ...link, deletedAt: 9 }), 2);
      expect(() => put(storage, "second", itemOf([], link))).not.toThrow();
    });
  });

  it("purges an item to a tombstone that keeps its id and drops everything it held", async () => {
    await inLibrary(({ storage }) => {
      put(
        storage,
        "gone",
        itemOf([paragraph("a", "findable words")], noteFixture({ tags: ["work"] })),
      );
      storeTombstone(storage, { deletedAt: 7, id: "gone", seq: 2, updatedAt: 8 });
      expect(readItem(storage.db, "gone")).toStrictEqual({
        deletedAt: 7,
        id: "gone",
        kind: "purged",
        seq: 2,
        updatedAt: 8,
      });
      expect(readSeedBlocks(storage.db, "gone")).toStrictEqual([]);
      expect(runPlan(storage, searchLibrary("findable", 10))).toStrictEqual([]);
      expect(storage.all("SELECT count(*) AS n FROM item_tags", [])).toStrictEqual([{ n: 0 }]);
    });
  });

  it("lays no tombstone over a newer row, which keeps everything it holds", async () => {
    await inLibrary(({ storage }) => {
      const state = itemOf([paragraph("a", "findable words")], noteFixture({ tags: ["work"] }));
      put(storage, "kept", state, 5);
      expect(storeTombstone(storage, { deletedAt: 7, id: "kept", seq: 4, updatedAt: 8 })).toBe(
        false,
      );
      expect(laidOf(storage, "kept")).toStrictEqual(state);
      expect(
        runPlan(storage, searchLibrary("findable", 10)).map((hit) => hit.itemId),
      ).toStrictEqual(["kept"]);
      expect(storeTombstone(storage, { deletedAt: 7, id: "kept", seq: 6, updatedAt: 8 })).toBe(
        true,
      );
    });
  });

  it("builds the largest legal item into a row a Durable Object takes", async () => {
    // one unit that is three bytes of UTF-8, and one that is six bytes once escaped in JSON
    const wide = "語";
    const escaped = "\u0001";
    const caps = ITEM_FIELD_CAPS;
    const line = (unit: string): string => unit.repeat(caps.line);
    // a list of `entryOf`'s entries, up to whichever of its caps binds first
    const fullList = (entryOf: (index: number) => string): string[] => {
      const list: string[] = [];
      let bytes = 2;
      for (let index = 0; index < caps.listEntries; index += 1) {
        const entry = entryOf(index);
        const more = utf8ByteLength(JSON.stringify(entry)) + (list.length === 0 ? 0 : 1);
        if (bytes + more > caps.listBytes) {
          break;
        }
        list.push(entry);
        bytes += more;
      }
      return list;
    };
    const propertyKey = line("k");
    const room = caps.propertiesBytes - utf8ByteLength(canonicalJson({ [propertyKey]: "" }));
    const host = "https://例え.jp/";
    const fields: LibraryItemFields = {
      aliases: fullList((index) => `${String(index)}${escaped.repeat(caps.line - 4)}`),
      author: line(wide),
      coverSha: "d".repeat(64),
      deletedAt: null,
      description: wide.repeat(caps.description),
      fetchError: line(wide),
      fetchState: "failed",
      fetchedAt: 1,
      folderId: line(wide),
      kind: "link",
      lang: line(wide),
      originalName: `${wide.repeat(caps.line - 4)}.pdf`,
      originalSha: "e".repeat(64),
      pinnedAt: 1,
      properties: { [propertyKey]: escaped.repeat(Math.floor(room / 6)) },
      published: line(wide),
      savedAt: 1,
      site: line(wide),
      tags: fullList((index) => `${wide.repeat(caps.line - 4)}${String(index)}`),
      title: line(escaped),
      url: `${host}${wide.repeat(caps.url - host.length)}`,
    };
    expect(libraryItemFieldsSchema.safeParse(fields).error?.issues).toBeUndefined();
    // more headings than any outline keeps, each longer than any outline line, after a paragraph
    // the preview reads from
    const blocks: LibraryBlock[] = [
      { children: [{ text: escaped.repeat(caps.line) }], id: "p".repeat(64), type: "p" },
      ...Array.from({ length: 1000 }, (_, index): LibraryBlock => ({
        children: [{ text: escaped.repeat(caps.line) }],
        id: String(index).padStart(64, "h"),
        type: "h1",
      })),
    ];
    expect(blocks.every((block) => storableBlockSchema.validate(block))).toBe(true);
    const id = "0190a3f2-7c4e-7d1a-9b2c-3e4f5a6b7c8d";
    await inLibrary(({ storage }) => {
      put(storage, id, itemOf(blocks, fields));
      const row = storage.db.select().from(itemRows).where(eq(itemRows.id, id)).get();
      // each value as its text and eight bytes more: past what SQLite stores, a number in eight
      // bytes at most and a string as its UTF-8 behind a short header
      const rowBytes = Object.values(row ?? {}).reduce<number>(
        (sum, value) => sum + utf8ByteLength(String(value ?? "")) + 8,
        0,
      );
      expect(rowBytes).toBeGreaterThan(500_000);
      expect(rowBytes).toBeLessThan(2_000_000);
    });
  });
});

describe("seeds", () => {
  it("keeps many blocks in statements a Durable Object takes, reads them in order, and replaces them whole", async () => {
    await inLibrary(({ storage }) => {
      const blocks = Array.from({ length: 600 }, (_, index) =>
        paragraph(`b${String(index)}`, `text ${String(index)}`),
      );
      const state = itemOf(blocks);
      put(storage, "long", state);
      expect(readSeedBlocks(storage.db, "long")).toStrictEqual(state.blocks);
      const shorter = itemOf(blocks.slice(40));
      storeSeed(storage.db, "long", shorter.blocks);
      expect(readSeedBlocks(storage.db, "long")).toStrictEqual(shorter.blocks);
    });
  });
});

describe("search", () => {
  it("ranks a title above a body, finds a stem and a half-typed word, and skips Deleted", async () => {
    await inLibrary(({ storage }) => {
      put(
        storage,
        "titled",
        itemOf([paragraph("a", "nothing here")], noteFixture({ title: "Gardening" })),
      );
      put(
        storage,
        "body",
        itemOf([paragraph("a", "notes on gardening tools")], noteFixture({ title: "Misc" })),
      );
      put(
        storage,
        "gone",
        itemOf([paragraph("a", "gardening")], noteFixture({ deletedAt: 1, title: "Old" })),
      );
      expect(
        runPlan(storage, searchLibrary("gardening", 10)).map((hit) => hit.itemId),
      ).toStrictEqual(["titled", "body"]);
      expect(runPlan(storage, searchLibrary("garden", 10)).map((hit) => hit.itemId)).toStrictEqual([
        "titled",
        "body",
      ]);
    });
  });

  it(
    "cuts an item's index row under a Durable Object's row limit",
    { timeout: 30_000 },
    async () => {
      const huge = "word ".repeat(1_000_000);
      const row = searchRowOf({ body: huge, headings: "", meta: "", title: "t" });
      expect(searchRowBytes(row)).toBeLessThanOrEqual(SEARCH_ROW_MAX_BYTES);
      expect(row.body.length).toBeGreaterThan(500_000);
      await inLibrary(({ storage }) => {
        put(
          storage,
          "huge",
          itemOf(
            Array.from({ length: 12 }, (_, index) =>
              paragraph(`p${String(index)}`, huge.slice(0, 400_000)),
            ),
          ),
        );
        expect(runPlan(storage, searchLibrary("word", 1)).map((hit) => hit.itemId)).toStrictEqual([
          "huge",
        ]);
      });
    },
  );
});

describe(literalMatches, () => {
  it("names each live item whose body holds the text, ascii case folded, with its first such line", async () => {
    await inLibrary(({ statements, storage }) => {
      put(
        storage,
        "one",
        itemOf(
          [paragraph("z", "The Quick fox"), paragraph("b", "jumps"), paragraph("a", "quick again")],
          noteFixture({ title: "One" }),
        ),
      );
      put(storage, "two", itemOf([paragraph("a", "slow")], noteFixture({ title: "Two" })));
      put(storage, "gone", itemOf([paragraph("a", "quick")], noteFixture({ deletedAt: 1 })));
      expect(runPlan(storage, literalMatches("QUICK", { after: null, limit: 10 }))).toStrictEqual([
        { itemId: "one", text: "The Quick fox" },
      ]);
      expect(
        statements.some((statement) => /instr\(lower\(t\.text\), \?\)/u.test(statement.sql)),
      ).toBe(true);
    });
  });

  it("pages through the items in id order, reading no more of them than a page asks", async () => {
    await inLibrary(({ statements, storage }) => {
      for (const id of ["c", "a", "d", "b"]) {
        put(storage, id, itemOf([paragraph("p", `item ${id} holds xyzzy`)]));
      }
      const before = statements.length;
      const first = runPlan(storage, literalMatches("xyzzy", { after: null, limit: 3 }));
      expect(first.map((match) => match.itemId)).toStrictEqual(["a", "b", "c"]);
      const reads = statements
        .slice(before)
        .filter((statement) => statement.sql.startsWith("SELECT text FROM body_texts"));
      expect(reads).toHaveLength(3);
      expect(runPlan(storage, literalMatches("xyzzy", { after: "c", limit: 3 }))).toStrictEqual([
        { itemId: "d", text: "item d holds xyzzy" },
      ]);
    });
  });
});

describe("links", () => {
  it("answers backlinks by id and Linked from by address, and holds no row for a link to no item", async () => {
    await inLibrary(({ storage }) => {
      put(
        storage,
        "target",
        itemOf([], noteFixture({ kind: "link", title: "Target", url: "https://example.com/t" })),
      );
      put(
        storage,
        "source",
        itemOf([
          linkTo("target", "Target"),
          linkTo(null, "Some Future"),
          {
            children: [{ children: [{ text: "x" }], type: "a", url: "https://www.example.com/t" }],
            id: "u",
            type: "p",
          },
        ]),
      );
      expect(linksTo(storage.db, "target")).toStrictEqual(["source"]);
      expect(linksToUrl(storage.db, "example.com/t")).toStrictEqual(["source"]);
      expect(
        storage.all("SELECT target_id, target_key FROM links ORDER BY target_key", []),
      ).toStrictEqual([
        { target_id: "target", target_key: null },
        { target_id: null, target_key: "example.com/t" },
      ]);
    });
  });
});

describe("meta", () => {
  it("counts the head up one write at a time and keeps meta values as they were written", async () => {
    await inLibrary(({ storage }) => {
      expect(nextHead(storage.db)).toBe(1);
      expect(nextHead(storage.db)).toBe(2);
      writeMeta(storage.db, "deleted_at", 7);
      writeMeta(storage.db, "rules", "42");
      expect(readMeta(storage.db, "deleted_at")).toBe(7);
      expect(readMeta(storage.db, "rules")).toBe("42");
      expect(readMeta(storage.db, "missing")).toBeNull();
    });
  });
});
