import { describe, expect, it } from "vitest";

import { orderedBlocks } from "./block-ops";
import type { ItemState } from "./block-ops";
import { canonicalJson, utf8ByteLength } from "./canonical-json";
import { deriveItem } from "./derive-item";
import { ITEM_FIELD_CAPS, libraryItemFieldsSchema } from "./library-item";
import type { LibraryItemFields } from "./library-item";
import {
  blockWritesOf,
  dropBlocks,
  linksTo,
  linksToUrl,
  danglingLinksTo,
  matchCandidates,
  nextHead,
  readAnnotations,
  readBlocks,
  readChanges,
  readItem,
  readItemState,
  readMeta,
  recordChanges,
  SEARCH_ROW_MAX_BYTES,
  searchLibrary,
  searchRowBytes,
  searchRowOf,
  storeBlocks,
  storeItem,
  storeItemRow,
  storeTombstone,
  writeMeta,
} from "./library-queries";
import { storableBlockSchema } from "./library-nodes";
import type { LibraryBlock } from "./library-nodes";
import { ensureLibrarySchema } from "./library-schema";
import { runPlan, transactPlan } from "./library-sql";
import type { SqlPlan } from "./library-sql";
import { itemOf, noteFields, paragraph } from "../test-support/library-items";
import { openWasmSqlPort } from "../test-support/wasm-sql-port";
import type { WasmSqlPort } from "../test-support/wasm-sql-port";

const leaf: [{ text: "" }] = [{ text: "" }];

const library = (): WasmSqlPort => {
  const port = openWasmSqlPort();
  transactPlan(port, ensureLibrarySchema("cell"));
  return port;
};

const exec = <T>(port: WasmSqlPort, plan: SqlPlan<T>): T => transactPlan(port, plan);

const offer = (port: WasmSqlPort, id: string, state: ItemState, seq: number) =>
  exec(port, storeItem({ id, seq, state, updatedAt: 1_700_000_000_000 + seq }));

const put = (port: WasmSqlPort, id: string, state: ItemState, seq = 1) => {
  const derived = offer(port, id, state, seq);
  if (derived === null) {
    throw new Error(`the row of ${id} at ${String(seq)} did not land`);
  }
  return derived;
};

const linkTo = (itemId: string | null, title: string): LibraryBlock => ({
  children: [{ text: "see " }, { children: leaf, itemId, title, type: "wikiLink" }],
  id: `to-${title.replaceAll(" ", "-")}`,
  type: "p",
});

describe("items", () => {
  it("stores an item whole and reads it back as written", () => {
    const port = library();
    const state = itemOf(
      [paragraph("a", "first"), paragraph("b", "second")],
      noteFields({ aliases: ["Alt"], properties: { rating: 4 }, tags: ["work"] }),
    );
    const derived = put(port, "item-1", state);
    expect(exec(port, readItem("item-1"))).toEqual({
      card: derived.card,
      fields: state.fields,
      id: "item-1",
      kind: "live",
      seq: 1,
      updatedAt: 1_700_000_000_001,
      urlKey: null,
    });
    expect(exec(port, readItemState("item-1"))).toEqual(state);
  });

  it("keeps the newer item whole when an older one arrives: row, body, links, tags and index", () => {
    const port = library();
    const newer = itemOf(
      [linkTo("target", "Target"), paragraph("a", "newer words")],
      noteFields({ tags: ["fresh"], title: "Newer" }),
    );
    put(port, "item-1", newer, 5);
    const older = itemOf(
      [paragraph("a", "older words")],
      noteFields({ tags: ["stale"], title: "Older" }),
    );
    expect(offer(port, "item-1", older, 3)).toBeNull();
    expect(offer(port, "item-1", older, 5)).toBeNull();
    expect(
      exec(
        port,
        storeItemRow({
          derived: deriveItem(older.fields, older.blocks),
          fields: older.fields,
          id: "item-1",
          seq: 4,
          updatedAt: 1,
        }),
      ),
    ).toBe(false);
    expect(exec(port, readItemState("item-1"))).toEqual(newer);
    expect(exec(port, searchLibrary("older", 10))).toEqual([]);
    expect(exec(port, searchLibrary("newer", 10)).map((hit) => hit.itemId)).toEqual(["item-1"]);
    expect(port.all("SELECT tag, origin FROM item_tags WHERE item_id = ?", ["item-1"])).toEqual([
      { origin: "field", tag: "fresh" },
    ]);
    expect(exec(port, linksTo("target")).map((link) => link.sourceId)).toEqual(["item-1"]);
  });

  it("holds one live item per address", () => {
    const port = library();
    const link = noteFields({ kind: "link", url: "https://example.com/a" });
    put(port, "first", itemOf([], link));
    expect(() =>
      put(port, "second", itemOf([], { ...link, url: "https://www.example.com/a" })),
    ).toThrow(/UNIQUE/u);
    put(port, "first", itemOf([], { ...link, deletedAt: 9 }), 2);
    expect(() => put(port, "second", itemOf([], link))).not.toThrow();
  });

  it("purges an item to a tombstone that keeps its id and drops everything it held", () => {
    const port = library();
    put(port, "gone", itemOf([paragraph("a", "findable words")], noteFields({ tags: ["work"] })));
    exec(port, storeTombstone({ deletedAt: 7, id: "gone", seq: 2, updatedAt: 8 }));
    expect(exec(port, readItem("gone"))).toEqual({
      deletedAt: 7,
      id: "gone",
      kind: "purged",
      seq: 2,
      updatedAt: 8,
    });
    expect(exec(port, readBlocks("gone"))).toEqual([]);
    expect(exec(port, searchLibrary("findable", 10))).toEqual([]);
    expect(port.all("SELECT count(*) AS n FROM item_tags", [])).toEqual([{ n: 0 }]);
  });

  it("lays no tombstone over a newer row, which keeps everything it holds", () => {
    const port = library();
    const state = itemOf([paragraph("a", "findable words")], noteFields({ tags: ["work"] }));
    put(port, "kept", state, 5);
    expect(exec(port, storeTombstone({ deletedAt: 7, id: "kept", seq: 4, updatedAt: 8 }))).toBe(
      false,
    );
    expect(exec(port, readItemState("kept"))).toEqual(state);
    expect(exec(port, searchLibrary("findable", 10)).map((hit) => hit.itemId)).toEqual(["kept"]);
    expect(exec(port, storeTombstone({ deletedAt: 7, id: "kept", seq: 6, updatedAt: 8 }))).toBe(
      true,
    );
  });

  it("builds the largest legal item into a row a Durable Object takes", () => {
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
      copySha: "c".repeat(64),
      coverSha: "d".repeat(64),
      deletedAt: null,
      description: wide.repeat(caps.description),
      fetchError: line(wide),
      fetchState: "failed",
      fetchedAt: 1,
      folderId: line(wide),
      kind: "link",
      lang: line(wide),
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
        id: `${String(index)}`.padStart(64, "h"),
        type: "h1",
      })),
    ];
    expect(blocks.every((block) => storableBlockSchema.validate(block))).toBe(true);
    const port = library();
    put(port, "0190a3f2-7c4e-7d1a-9b2c-3e4f5a6b7c8d", itemOf(blocks, fields));
    const upsert = port.statements.find((statement) =>
      statement.sql.startsWith("INSERT INTO items"),
    );
    // each value as its text and eight bytes more: past what SQLite stores, a number in eight
    // bytes at most and a string as its UTF-8 behind a short header
    const rowBytes = (upsert?.params ?? []).reduce<number>(
      (sum, value) => sum + utf8ByteLength(String(value ?? "")) + 8,
      0,
    );
    expect(rowBytes).toBeGreaterThan(500_000);
    expect(rowBytes).toBeLessThan(2_000_000);
  });
});

describe("blocks", () => {
  it("writes many blocks in statements a Durable Object takes, and reads them in order", () => {
    const port = library();
    const blocks = Array.from({ length: 60 }, (_, index) =>
      paragraph(`b${String(index)}`, `text ${String(index)}`),
    );
    const state = itemOf(blocks);
    put(port, "long", state);
    const inserts = port.statements.filter((statement) =>
      statement.sql.startsWith("INSERT INTO blocks"),
    );
    expect(inserts.length).toBeGreaterThan(1);
    expect(exec(port, readBlocks("long"))).toEqual(orderedBlocks(state.blocks));
    exec(
      port,
      dropBlocks(
        "long",
        blocks.slice(0, 40).map((block) => block.id),
      ),
    );
    expect(exec(port, readBlocks("long")).map(({ block }) => block.id)).toEqual(
      blocks.slice(40).map((block) => block.id),
    );
  });

  it("replaces a block in place with its text and anchored highlights", () => {
    const port = library();
    const state = itemOf([paragraph("a", "one")]);
    put(port, "item", state);
    const marked: LibraryBlock = {
      children: [
        { children: leaf, edge: "start", ids: "h1", type: "annotationMarker" },
        { text: "marked" },
        { children: leaf, edge: "end", ids: "h1", type: "annotationMarker" },
      ],
      id: "a",
      type: "p",
    };
    const next = itemOf([marked]);
    const derived = deriveItem(next.fields, next.blocks);
    exec(port, storeBlocks("item", blockWritesOf(orderedBlocks(next.blocks), derived), 2));
    expect(
      port.all("SELECT text, annotation_ids, seq FROM blocks WHERE item_id = ?", ["item"]),
    ).toEqual([{ annotation_ids: '["h1"]', seq: 2, text: "marked" }]);
    const older = itemOf([paragraph("a", "older")]);
    exec(
      port,
      storeBlocks(
        "item",
        blockWritesOf(orderedBlocks(older.blocks), deriveItem(older.fields, older.blocks)),
        1,
      ),
    );
    expect(port.all("SELECT text, seq FROM blocks WHERE item_id = ?", ["item"])).toEqual([
      { seq: 2, text: "marked" },
    ]);
  });
});

describe("search", () => {
  it("ranks a title above a body, finds a stem and a half-typed word, and skips Deleted", () => {
    const port = library();
    put(
      port,
      "titled",
      itemOf([paragraph("a", "nothing here")], noteFields({ title: "Gardening" })),
    );
    put(
      port,
      "body",
      itemOf([paragraph("a", "notes on gardening tools")], noteFields({ title: "Misc" })),
    );
    put(
      port,
      "gone",
      itemOf([paragraph("a", "gardening")], noteFields({ deletedAt: 1, title: "Old" })),
    );
    expect(exec(port, searchLibrary("gardening", 10)).map((hit) => hit.itemId)).toEqual([
      "titled",
      "body",
    ]);
    expect(exec(port, searchLibrary("garden", 10)).map((hit) => hit.itemId)).toEqual([
      "titled",
      "body",
    ]);
    expect(exec(port, searchLibrary("tool", 10, { typing: false }))).toEqual([
      expect.objectContaining({ itemId: "body", snippet: expect.stringContaining("tools") }),
    ]);
  });

  it("cuts an item's index row under a Durable Object's row limit", () => {
    const huge = "word ".repeat(1_000_000);
    const row = searchRowOf({ body: huge, headings: "", meta: "", title: "t" });
    expect(searchRowBytes(row)).toBeLessThanOrEqual(SEARCH_ROW_MAX_BYTES);
    expect(row.body.length).toBeGreaterThan(500_000);
    const port = library();
    put(
      port,
      "huge",
      itemOf(
        Array.from({ length: 12 }, (_, index) =>
          paragraph(`p${String(index)}`, huge.slice(0, 400_000)),
        ),
      ),
    );
    expect(exec(port, searchLibrary("word", 1)).map((hit) => hit.itemId)).toEqual(["huge"]);
  });
});

describe("matchCandidates", () => {
  it("narrows by instr over each block's text, ascii case folded, and reads live items only", () => {
    const port = library();
    put(
      port,
      "one",
      itemOf(
        [paragraph("a", "The Quick fox"), paragraph("b", "jumps")],
        noteFields({ title: "One" }),
      ),
    );
    put(port, "two", itemOf([paragraph("a", "slow")], noteFields({ title: "Two" })));
    put(port, "gone", itemOf([paragraph("a", "quick")], noteFields({ deletedAt: 1 })));
    expect(exec(port, matchCandidates(["QUICK"]))).toEqual([
      { body: "The Quick fox\njumps", itemId: "one", title: "One" },
    ]);
    expect(exec(port, matchCandidates(null)).map((text) => text.itemId)).toEqual(["one", "two"]);
    expect(exec(port, matchCandidates([]))).toEqual([]);
    expect(
      port.statements.some((statement) => /instr\(lower\(text\), \?\)/u.test(statement.sql)),
    ).toBe(true);
  });
});

describe("links", () => {
  it("answers backlinks by id, Linked from by address, and dangling links by title", () => {
    const port = library();
    put(
      port,
      "target",
      itemOf([], noteFields({ kind: "link", title: "Target", url: "https://example.com/t" })),
    );
    put(
      port,
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
    expect(exec(port, linksTo("target")).map((link) => link.sourceId)).toEqual(["source"]);
    expect(exec(port, linksToUrl("example.com/t"))).toEqual([
      expect.objectContaining({ blockId: "u", kind: "url", sourceId: "source" }),
    ]);
    expect(exec(port, danglingLinksTo("some future"))).toEqual([
      expect.objectContaining({ blockId: "to-Some-Future", kind: "wiki" }),
    ]);
  });
});

describe("highlights", () => {
  it("reads an item's live highlights as an annotation store", () => {
    const port = library();
    port.run(
      `INSERT INTO annotations (id, item_id, parent_id, text, quote, source, created_at, updated_at, deleted_at, seq)
       VALUES ('h1', 'item', NULL, '', 'a passage', 'user', 1, 2, NULL, 1),
              ('h2', 'item', 'h1', 'a reply', NULL, NULL, 3, 3, NULL, 1),
              ('h3', 'item', NULL, 'gone', NULL, NULL, 4, 4, 9, 1)`,
      [],
    );
    expect(exec(port, readAnnotations("item"))).toEqual({
      h1: { createdAt: 1, quote: "a passage", source: "user", text: "", updatedAt: 2 },
      h2: { createdAt: 3, parentId: "h1", text: "a reply", updatedAt: 3 },
    });
  });
});

describe("the change log", () => {
  it("pages by sequence number and never ends a page inside one write", () => {
    const port = library();
    const entries = [1, 1, 1, 2, 3, 3].map((seq, index) => ({
      gone: index === 5,
      id: `i${String(index)}`,
      kind: "item" as const,
      seq,
    }));
    exec(port, recordChanges(entries));
    const first = exec(port, readChanges(0, 2));
    expect(first).toEqual({ changes: entries.slice(0, 3), more: true, upto: 1 });
    const second = exec(port, readChanges(first.upto, 2));
    expect(second.changes.map((entry) => entry.id)).toEqual(["i3", "i4", "i5"]);
    expect(second.more).toBe(false);
    expect(exec(port, readChanges(second.upto, 2))).toEqual({ changes: [], more: false, upto: 3 });
  });

  it("counts the head up one write at a time and keeps meta values", () => {
    const port = library();
    expect(runPlan(port, nextHead())).toBe(1);
    expect(runPlan(port, nextHead())).toBe(2);
    exec(port, writeMeta("epoch", "e-1"));
    expect(exec(port, readMeta("epoch"))).toBe("e-1");
    expect(exec(port, readMeta("missing"))).toBeNull();
  });
});
