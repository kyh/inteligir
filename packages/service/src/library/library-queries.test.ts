import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { z } from "zod";

import { canonicalJson, utf8ByteLength } from "@repo/contract/library/canonical-json";
import { deriveBody, deriveItem } from "@repo/contract/library/derive-item";
import type { BodyBlock } from "@repo/contract/library/derive-item";
import { ITEM_FIELD_CAPS, libraryItemFieldsSchema } from "@repo/contract/library/library-item";
import type { LibraryItemFields } from "@repo/contract/library/library-item";
import { literalMatches, searchHits } from "../search/search-hits";
import { searchLibrary, searchRowOf, storeSearchRow } from "../search/search-index";
import {
  idTaken,
  linksTo,
  linksToUrl,
  nextHead,
  purgeItem,
  readCellState,
  readItem,
  readListingRows,
  readListingSince,
  storeItemRow,
  storeLinks,
  storeTags,
  writeCellState,
} from "./library-queries";
import { storableBlockSchema } from "@repo/contract/library/library-nodes";
import type { LibraryBlock } from "@repo/contract/library/library-nodes";
import { noteFixture, paragraph } from "@repo/contract/test-support/library-items";

import { cellOf, inCell } from "../test-support/library-cell";
import { readSeedBlocks, storeBodyText, storeSeed } from "./cell-body";
import { cellDbOf } from "./cell-db";
import type { CellDb } from "./cell-db";

const leaf: [{ text: "" }] = [{ text: "" }];

// a fresh cell's handle, every statement it runs recorded as drizzle writes it; the cell itself
// holds every statement to a Durable Object's limits
interface Library {
  readonly db: CellDb;
  readonly statements: string[];
}

const inLibrary = async (work: (library: Library) => void): Promise<void> => {
  await inCell(cellOf(), (state) => {
    const statements: string[] = [];
    const db = cellDbOf(state.storage, {
      logQuery: (statement) => {
        statements.push(statement);
      },
    });
    work({ db, statements });
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

// a row, then its seed and derived rows under it, as the cell lays an item
const put = (db: CellDb, id: string, state: Laid, seq = 1) =>
  db.$client.transactionSync(() => {
    const body = deriveBody(state.blocks);
    const derived = deriveItem(state.fields, body.digest);
    storeItemRow(db, {
      body: { bytes: 0, digest: body.digest, home: "seed", version: 0 },
      card: derived.card,
      fields: state.fields,
      id,
      seq,
      updatedAt: 1_700_000_000_000 + seq,
      urlKey: derived.urlKey,
    });
    storeSeed(db, id, state.blocks);
    storeBodyText(db, id, body.text);
    storeLinks(db, id, body.links);
    storeTags(db, id, derived.tags);
    storeSearchRow(db, id, { ...derived.search, body: body.text });
    return derived;
  });

// an item's fields and seed as the cell holds them
const laidOf = (db: CellDb, id: string): Laid | null => {
  const item = readItem(db, id);
  return item === null ? null : { blocks: readSeedBlocks(db, id), fields: item.fields };
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
    await inLibrary(({ db }) => {
      const state = itemOf(
        [paragraph("a", "first"), paragraph("b", "second")],
        noteFixture({ aliases: ["Alt"], properties: { rating: 4 }, tags: ["work"] }),
      );
      const derived = put(db, "item-1", state);
      expect(readItem(db, "item-1")).toStrictEqual({
        body: {
          bytes: 0,
          digest: deriveBody(state.blocks).digest,
          home: "seed",
          version: 0,
        },
        card: derived.card,
        fields: state.fields,
        id: "item-1",
        seq: 1,
        updatedAt: 1_700_000_000_001,
        urlKey: null,
      });
      expect(laidOf(db, "item-1")).toStrictEqual(state);
    });
  });

  it("reads every item by id, and what writes past a sequence wrote and purged", async () => {
    await inLibrary(({ db }) => {
      put(db, "b", itemOf([], noteFixture({ title: "B" })), 1);
      put(db, "a", itemOf([], noteFixture({ title: "A" })), 2);
      put(db, "c", itemOf([], noteFixture({ title: "C" })), 3);
      purgeItem(db, "c", 4);
      expect(readListingRows(db).map((row) => row.id)).toStrictEqual(["a", "b"]);
      const since = readListingSince(db, 1);
      expect(since.items.map((row) => row.id)).toStrictEqual(["a"]);
      expect(since.purged).toStrictEqual(["c"]);
      expect(readListingSince(db, 4)).toStrictEqual({ items: [], purged: [] });
    });
  });

  it("holds one live item per address", async () => {
    await inLibrary(({ db }) => {
      const link = noteFixture({ kind: "link", url: "https://example.com/a" });
      put(db, "first", itemOf([], link));
      expect(() =>
        put(db, "second", itemOf([], { ...link, url: "https://www.example.com/a" })),
      ).toThrow(
        expect.objectContaining({
          cause: expect.objectContaining({ message: expect.stringMatching(/UNIQUE/u) }),
        }),
      );
      put(db, "first", itemOf([], { ...link, deletedAt: 9 }), 2);
      expect(() => put(db, "second", itemOf([], link))).not.toThrow();
    });
  });

  it("purges an item: everything it held goes, and its id stays taken", async () => {
    await inLibrary(({ db }) => {
      put(db, "gone", itemOf([paragraph("a", "findable words")], noteFixture({ tags: ["work"] })));
      expect(idTaken(db, "gone")).toBe(true);
      purgeItem(db, "gone", 2);
      expect(readItem(db, "gone")).toBeNull();
      expect(idTaken(db, "gone")).toBe(true);
      expect(idTaken(db, "never")).toBe(false);
      expect(readSeedBlocks(db, "gone")).toStrictEqual([]);
      expect(searchLibrary(db, "findable", 10).ids).toStrictEqual([]);
      expect(db.all(sql`SELECT count(*) AS n FROM item_tags`)).toStrictEqual([{ n: 0 }]);
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
      folderId: line(wide),
      kind: "link",
      lang: line(wide),
      originalName: `${wide.repeat(caps.line - 4)}.pdf`,
      originalSha: "e".repeat(64),
      pinnedAt: 1,
      properties: { [propertyKey]: escaped.repeat(Math.floor(room / 6)) },
      published: line(wide),
      reading: { at: 1, error: line(wide), state: "failed" },
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
    await inLibrary(({ db }) => {
      put(db, id, itemOf(blocks, fields));
      const row = z
        .record(z.string(), z.union([z.string(), z.number(), z.null()]))
        .parse(db.$client.sql.exec("SELECT * FROM items WHERE id = ?", id).one());
      // each value as its text and eight bytes more: past what SQLite stores, a number in eight
      // bytes at most and a string as its UTF-8 behind a short header
      const rowBytes = Object.values(row).reduce<number>(
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
    await inLibrary(({ db }) => {
      const blocks = Array.from({ length: 600 }, (_, index) =>
        paragraph(`b${String(index)}`, `text ${String(index)}`),
      );
      const state = itemOf(blocks);
      put(db, "long", state);
      expect(readSeedBlocks(db, "long")).toStrictEqual(state.blocks);
      const shorter = itemOf(blocks.slice(40));
      storeSeed(db, "long", shorter.blocks);
      expect(readSeedBlocks(db, "long")).toStrictEqual(shorter.blocks);
    });
  });
});

describe("search", () => {
  it("ranks a title above a body, finds a stem and a half-typed word, and skips Deleted", async () => {
    await inLibrary(({ db }) => {
      put(
        db,
        "titled",
        itemOf([paragraph("a", "nothing here")], noteFixture({ title: "Gardening" })),
      );
      put(
        db,
        "body",
        itemOf([paragraph("a", "notes on gardening tools")], noteFixture({ title: "Misc" })),
      );
      put(
        db,
        "gone",
        itemOf([paragraph("a", "gardening")], noteFixture({ deletedAt: 1, title: "Old" })),
      );
      expect(searchLibrary(db, "gardening", 10).ids).toStrictEqual(["titled", "body"]);
      expect(searchLibrary(db, "garden", 10).ids).toStrictEqual(["titled", "body"]);
    });
  });

  it(
    "indexes as much of a body, and of its stems, as a Durable Object binds in a value",
    { timeout: 30_000 },
    async () => {
      // decomposed for its stems, Hangul is two and a half times its bytes
      const row = searchRowOf({
        body: "한국어 ".repeat(100_000),
        headings: "",
        meta: "",
        title: "",
      });
      expect(
        Object.fromEntries(
          Object.entries(row).map(([column, text]) => [column, utf8ByteLength(text)]),
        ),
      ).toStrictEqual({
        body: 1_000_000,
        bodyStems: 1_900_000,
        headingStems: 0,
        headings: 0,
        meta: 0,
        metaStems: 0,
        title: 0,
        titleStems: 0,
      });
      await inLibrary(({ db }) => {
        put(
          db,
          "huge",
          itemOf(
            Array.from({ length: 12 }, (_, index) =>
              paragraph(`p${String(index)}`, "word ".repeat(80_000)),
            ),
          ),
        );
        expect(searchLibrary(db, "word", 1).ids).toStrictEqual(["huge"]);
      });
    },
  );
});

describe(literalMatches, () => {
  it("names each live item whose body holds the text, ascii case folded", async () => {
    await inLibrary(({ db, statements }) => {
      put(
        db,
        "one",
        itemOf(
          [paragraph("z", "The Quick fox"), paragraph("b", "jumps"), paragraph("a", "quick again")],
          noteFixture({ title: "One" }),
        ),
      );
      put(db, "two", itemOf([paragraph("a", "slow")], noteFixture({ title: "Two" })));
      put(db, "gone", itemOf([paragraph("a", "quick")], noteFixture({ deletedAt: 1 })));
      expect(literalMatches(db, "QUICK", { after: null, limit: 10 })).toStrictEqual(["one"]);
      expect(
        statements.some((statement) => statement.includes(`instr(lower("body_texts"."text"), ?)`)),
      ).toBe(true);
    });
  });

  it("pages through the items in id order", async () => {
    await inLibrary(({ db }) => {
      for (const id of ["c", "a", "d", "b"]) {
        put(db, id, itemOf([paragraph("p", `item ${id} holds xyzzy`)]));
      }
      expect(literalMatches(db, "xyzzy", { after: null, limit: 3 })).toStrictEqual(["a", "b", "c"]);
      expect(literalMatches(db, "xyzzy", { after: "c", limit: 3 })).toStrictEqual(["d"]);
    });
  });
});

describe(searchHits, () => {
  it("ranks every hit, and cuts a passage around the match only for the hit it is asked of", async () => {
    await inLibrary(({ db, statements }) => {
      const deep = `${"filler ".repeat(60)}the zebrafish swims`;
      put(db, "deep", itemOf([paragraph("a", deep)], noteFixture({ title: "Deep" })));
      put(
        db,
        "described",
        itemOf(
          [],
          noteFixture({
            description: "All about zebrafish.",
            kind: "link",
            title: "A page",
            url: "https://example.com/a",
          }),
        ),
      );
      put(db, "titled", itemOf([paragraph("a", "nothing")], noteFixture({ title: "Zebrafish" })));
      put(db, "part", itemOf([paragraph("a", "jumps"), paragraph("b", "call parse_zebrafish(x)")]));
      // a read of one item's body text, which the scan for the exact text is not
      const bodyReads = (): number =>
        statements.filter(
          (statement) =>
            /^select (?!distinct)/u.test(statement) &&
            statement.includes(`from "body_texts" where`),
        ).length;

      const hits = searchHits(db, "zebrafish", "live");
      expect(new Set(hits.rank.keys())).toStrictEqual(
        new Set(["deep", "described", "titled", "part"]),
      );
      // the index's words miss a part of a word, so its exact text finds it last
      expect(hits.rank.get("part")).toBe(3);
      expect(bodyReads()).toBe(0);

      expect(hits.passage("deep")).toBe(`… ${"filler ".repeat(5)}the zebrafish swims`);
      expect(hits.passage("described")).toBe("All about zebrafish.");
      expect(hits.passage("titled")).toBeNull();
      expect(hits.passage("part")).toBe("call parse_zebrafish(x)");
      expect(bodyReads()).toBe(4);
    });
  });
});

describe("links", () => {
  it("answers backlinks by id and Linked from by address, and holds no row for a link to no item", async () => {
    await inLibrary(({ db }) => {
      put(
        db,
        "target",
        itemOf([], noteFixture({ kind: "link", title: "Target", url: "https://example.com/t" })),
      );
      put(
        db,
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
      expect(linksTo(db, "target")).toStrictEqual(["source"]);
      expect(linksToUrl(db, "example.com/t")).toStrictEqual(["source"]);
      expect(
        db.all(sql`SELECT target_id, target_key FROM links ORDER BY target_key`),
      ).toStrictEqual([
        { target_id: "target", target_key: null },
        { target_id: null, target_key: "example.com/t" },
      ]);
    });
  });
});

describe("the cell's one row", () => {
  it("counts the head up one write at a time, and a fact written leaves the others as they were", async () => {
    await inLibrary(({ db }) => {
      expect(readCellState(db)).toBeUndefined();
      expect(nextHead(db)).toBe(1);
      expect(nextHead(db)).toBe(2);
      writeCellState(db, { deletedAt: 7 });
      writeCellState(db, { rules: "42" });
      expect(readCellState(db)).toStrictEqual({
        blobRemovals: 0,
        deletedAt: 7,
        head: 2,
        rules: "42",
        slot: 1,
      });
    });
  });
});
