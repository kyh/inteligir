import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { BLOCK_MAX_BYTES } from "@repo/notes/library/library-nodes";

import { generateDoc } from "../test-support/markdown-doc-generator";
import { pretendLibrary, withoutId } from "../test-support/codec-ports";
import { exportItem, importItem } from "./item-markdown";
import type { ImportedItem } from "./item-markdown";

const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/roundtrip/", import.meta.url));

const fixtures = (): { name: string; text: string }[] =>
  (["canonical", "churn"] as const).flatMap((dir) =>
    readdirSync(`${FIXTURES}${dir}`)
      .toSorted()
      .map((file) => ({
        name: `${dir}/${file}`,
        text: readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"),
      })),
  );

const library = pretendLibrary();

const imported = (
  text: string,
  annotations: string | null = null,
  name = "Fixture",
): ImportedItem => {
  const read = importItem({ annotations, name, text }, library.importPorts());
  if (!read.ok) {
    throw new Error(`the import refused: ${read.reason}`);
  }
  return read.item;
};

const exported = (item: ImportedItem): { text: string; annotations: string | null } =>
  exportItem(
    {
      annotations: item.annotations,
      blocks: new Map(
        item.blocks.map((placed): [string, StoredBlock] => [
          placed.block.id,
          { ...placed, hash: blockHash(placed.block) },
        ]),
      ),
      fields: { ...item.fields, deletedAt: null, folderId: null },
      id: "0195f3a0-5c1e-7000-8000-000000000001",
    },
    library.exportPorts(),
    // the file is named for the item, as an export names it, so its title rides in no key
    null,
  );

// the export's file, read back under the name an export gives it
const reimported = (item: ImportedItem): ImportedItem => {
  const written = exported(item);
  return imported(written.text, written.annotations, item.fields.title);
};

// what an item is, ids aside
const content = (item: ImportedItem) => ({
  annotations: item.annotations,
  blocks: item.blocks.map((placed) => ({ ...placed, block: withoutId(placed.block) })),
  fields: item.fields,
  refused: item.refused,
});

describe("import(export(v)) is v, ids aside", () => {
  for (const fixture of fixtures()) {
    it(fixture.name, () => {
      const first = imported(fixture.text);
      expect(content(reimported(first))).toEqual(content(first));
      expect(first.refused).toEqual([]);
    });
  }

  // the editor's own seeded documents: all seeds in one test, as its round-trip property runs them
  it("holds over the editor's generated documents", { timeout: 60_000 }, () => {
    for (let seed = 20_261_027; seed < 20_261_027 + 24; seed += 1) {
      const first = imported(generateDoc(seed));
      expect(content(reimported(first)), `seed ${String(seed)}`).toEqual(content(first));
    }
  });
});

describe("one file as its item", () => {
  it("reads the frontmatter into fields, and every other key as a typed property", () => {
    const item = imported(
      [
        "---",
        "id: 0195f3a0-5c1e-7000-8000-0000000000f1",
        "kind: link",
        "url: https://example.com/post",
        "site: Example",
        "saved: 2026-05-01T10:00:00Z",
        "tags: [reading, work/q3]",
        "pinned: true",
        "rating: 4",
        "done: false",
        "people: [Ada, Lin]",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    expect(item.fileId).toBe("0195f3a0-5c1e-7000-8000-0000000000f1");
    expect(item.fields).toMatchObject({
      fetchState: "pending",
      kind: "link",
      pinnedAt: Date.parse("2026-05-01T10:00:00Z"),
      properties: { done: false, people: ["Ada", "Lin"], rating: 4 },
      savedAt: Date.parse("2026-05-01T10:00:00Z"),
      site: "Example",
      tags: ["reading", "work/q3"],
      title: "Fixture",
      url: "https://example.com/post",
    });
    // a kind no item is stays the property it was written as
    expect(imported("---\nkind: book\n---\n\nBody.\n").fields).toMatchObject({
      kind: "note",
      properties: { kind: "book" },
    });
  });

  it("keeps a block that is not YAML as the note's first code block", () => {
    const item = imported("---\nkey: [unclosed\n---\n\nBody.\n");
    expect(item.fields.kind).toBe("note");
    expect(item.blocks.map(({ block }) => block.type)).toEqual(["code_block", "p"]);
    expect(JSON.stringify(item.blocks[0]?.block)).toContain("key: [unclosed");
  });

  it("cuts a block past the cap into blocks of its own type, its text kept whole", () => {
    const line = "A long line of a pasted log, written again and again.";
    const lines = Array.from(
      { length: Math.ceil((BLOCK_MAX_BYTES * 1.5) / line.length) },
      () => line,
    );
    const item = imported(`\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
    expect(item.refused).toEqual([]);
    expect(item.blocks.length).toBeGreaterThan(1);
    expect(new Set(item.blocks.map(({ block }) => block.type))).toEqual(new Set(["code_block"]));
    const text = item.blocks
      .flatMap(({ block }) => block.children)
      .map(
        (child) => JSON.stringify(child).match(/"text":"(?<text>[^"]*)"/u)?.groups?.["text"] ?? "",
      )
      .filter((piece) => piece !== "");
    expect(text).toEqual(lines);
  });

  it("reads the highlights' markers and their store, and says why a store could not be read", () => {
    const text = "Some %%i:h1:start%%marked words%%i:h1:end%% here.\n";
    const store = JSON.stringify({
      h1: { createdAt: 1, quote: "marked words", source: "user", text: "why", updatedAt: 1 },
    });
    const item = imported(text, store);
    expect(Object.keys(item.annotations)).toEqual(["h1"]);
    expect(JSON.stringify(item.blocks)).toContain('"type":"annotationMarker"');
    const broken = imported(text, "{ not json");
    expect(broken.annotations).toEqual({});
    expect(broken.annotationsError).not.toBeNull();
  });
});
