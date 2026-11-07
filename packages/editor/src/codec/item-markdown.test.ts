import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { ordsBetween } from "@repo/notes/library/block-order";
import { BLOCK_MAX_BYTES } from "@repo/notes/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/notes/library/library-nodes";

import { generateDoc } from "../test-support/markdown-doc-generator";
import { CODEC_NOW, pretendLibrary, withoutId } from "../test-support/codec-ports";
import { exportItem, importItem } from "./item-markdown";
import type { ImportedItem } from "./item-markdown";

const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/roundtrip/", import.meta.url));

const fixtures = (): { name: string; text: string }[] =>
  (["canonical", "churn", "frontmatter"] as const).flatMap((dir) =>
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
  leftOut: item.leftOut,
});

describe("import(export(v)) is v, ids aside", () => {
  it.each(fixtures())("$name", (fixture) => {
    const first = imported(fixture.text);
    expect(content(reimported(first))).toStrictEqual(content(first));
    expect(first.leftOut).toBe(0);
  });

  // the editor's own seeded documents: all seeds in one test, as its round-trip property runs them
  it("holds over the editor's generated documents", { timeout: 60_000 }, () => {
    for (let seed = 20_261_027; seed < 20_261_027 + 24; seed += 1) {
      const first = imported(generateDoc(seed));
      expect(content(reimported(first)), `seed ${String(seed)}`).toStrictEqual(content(first));
    }
  });
});

const FRONTMATTER_RE = /^---\n(?<yaml>[\s\S]*?)\n---\n(?:\n|$)/u;

// a file's body, its frontmatter aside: what the person wrote below it
const bodyOf = (text: string): string => text.replace(FRONTMATTER_RE, "");

// an item as the editor stores it, each block what a person typed, whatever its text spells
const typedItem = (section: LibrarySection, blocks: readonly LibraryBlock[]): ImportedItem => {
  const ords = ordsBetween(null, null, blocks.length);
  return {
    annotations: {},
    blocks: blocks.map((block, index) => ({ block, ord: ords[index] ?? "a0", section })),
    fields: { ...imported("").fields, title: "Typed" },
    leftOut: 0,
  };
};

const typedLine = (text: string, id = "typed"): LibraryBlock => ({
  children: [{ text }],
  id,
  type: "p",
});

const typedBody = (text: string): string =>
  bodyOf(exported(typedItem("note", [typedLine(text)])).text);

describe("Obsidian's spellings, through a real export and import", () => {
  const LOOK_ALIKES = [
    "area is r ^2",
    "x==1==y",
    "a==b and c==d",
    "==at the start==",
    "50%% and 60%%",
    "%%at the start%%",
    "^abc",
    "%%a ==b== c%%",
    "two lines ^x\nand ==more==",
  ];

  it.each(LOOK_ALIKES)("keeps %j, typed in a note, as the text it is", (text) => {
    const typed = typedItem("note", [typedLine("Before.", "before"), typedLine(text)]);
    const back = reimported(typed);
    expect(content(back)).toStrictEqual(content(typed));
    expect(content(reimported(back))).toStrictEqual(content(typed));
  });

  it.each(LOOK_ALIKES)("keeps %j, typed in a page, as the text it is", (text) => {
    const typed = typedItem("article", [typedLine("Before.", "before"), typedLine(text)]);
    expect(content(reimported(typed))).toStrictEqual(content(typed));
  });

  it("keeps whatever typed text strings the spellings' pieces together", () => {
    const pieces = [
      "=",
      "==",
      "%",
      "%%",
      "^",
      " ",
      "a",
      "-",
      "1",
      "i:",
      "\\",
      "==x==",
      "%%c%%",
      " ^r",
    ];
    // a fixed walk through them, so a failure names a text that fails again
    let state = 20_261_106;
    const pick = (bound: number): number => {
      state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
      return Math.floor((state / 4_294_967_296) * bound);
    };
    for (let round = 0; round < 200; round += 1) {
      const text = Array.from({ length: 1 + pick(8) }, () => pieces[pick(pieces.length)] ?? "")
        .join("")
        .trim();
      const typed = typedItem("note", [typedLine(`${text}.`), typedLine(text, "second")]);
      expect(content(reimported(typed)), JSON.stringify(text)).toStrictEqual(content(typed));
    }
  }, 60_000);

  it("keeps them typed anywhere a person writes", () => {
    const typed = typedItem("note", [
      { children: [{ text: "A title ^2" }], id: "heading", type: "h2" },
      {
        children: [{ text: "an item ^2 ==and== %%more%%" }],
        id: "item",
        indent: 1,
        listStyleType: "disc",
        type: "p",
      },
      { children: [{ bold: true, text: "==bold==" }], id: "bold", type: "p" },
      {
        children: [{ children: [{ text: "==quoted== ^2" }], type: "p" }],
        id: "quote",
        type: "blockquote",
      },
    ]);
    expect(content(reimported(typed))).toStrictEqual(content(typed));
  });

  it.each([...LOOK_ALIKES, "@2026-08-22", "{{1+1}}", "%%i:abc:start%%"])(
    "keeps %j, typed first in a to-do, as the text it is",
    (text) => {
      const todo = (checked: boolean, id: string): LibraryBlock => ({
        checked,
        children: [{ text }],
        id,
        indent: 1,
        listStyleType: "todo",
        type: "p",
      });
      const typed = typedItem("note", [todo(false, "open"), todo(true, "done")]);
      expect(content(reimported(typed))).toStrictEqual(content(typed));
    },
  );

  it("reads a real highlight and ref in a to-do", () => {
    const item = imported("- [ ] ==first== then ^ref\n");
    expect(Object.values(item.annotations).map(({ quote }) => quote)).toStrictEqual(["first"]);
    expect(item.blocks.map(({ block }) => block.ref)).toStrictEqual(["ref"]);
  });

  it("answers a file nested past what its spellings are read through as too deep", () => {
    for (const depth of [3000, 6000, 12_000]) {
      const text = `${"> ".repeat(depth)}x\n`;
      expect(
        importItem({ annotations: null, name: "Deep", text }, library.importPorts()),
      ).toStrictEqual({ ok: false, reason: "too-deep" });
    }
  });

  it("writes the escape that keeps typed text text, and none where nothing would read", () => {
    expect(typedBody("x==1==y")).toBe("x\\==1==y\n");
    expect(typedBody("50%% and 60%%")).toBe("50\\%% and 60%%\n");
    expect(typedBody("area is r ^2")).toBe("area is r \\^2\n");
    expect(typedBody("^abc")).toBe("\\^abc\n");
    expect(typedBody("a == b, 2 ^ 3 and 100%")).toBe("a == b, 2 ^ 3 and 100%\n");
    expect(typedBody("x^2 and y^3 are powers")).toBe("x^2 and y^3 are powers\n");
  });

  it("reads a real highlight, comment and ref, and writes each back as it stands", () => {
    const first = imported(
      [
        "An ==important== line %%not shown%% here. ^goal",
        "",
        "==at the start==",
        "",
        "- an item ^item",
        "",
        "| a |",
        "| - |",
        "| 1 |",
        "",
        "^tbl",
        "",
      ].join("\n"),
    );
    expect(Object.values(first.annotations).map(({ quote }) => quote)).toStrictEqual([
      "important",
      "at the start",
    ]);
    expect(first.blocks.map(({ block }) => block.ref)).toStrictEqual([
      "goal",
      undefined,
      "item",
      "tbl",
    ]);
    const stored = JSON.stringify(first.blocks);
    expect(stored).toContain('"source":"%%not shown%%"');
    expect(stored).not.toContain("==");
    expect(stored).not.toContain("^");
    expect(content(reimported(first))).toStrictEqual(content(first));
  });

  it("takes a backslash in a hand-written file as the person's text", () => {
    const item = imported("\\==kept== and a \\%%comment%% then a \\^ref\n\n\\^own\n");
    expect(item.annotations).toStrictEqual({});
    expect(item.blocks.map(({ block }) => block.ref)).toStrictEqual([undefined, undefined]);
    expect(item.blocks.map(({ block }) => block.children)).toStrictEqual([
      [{ text: "==kept== and a %%comment%% then a ^ref" }],
      [{ text: "^own" }],
    ]);
  });

  // a paragraph a `:::` line runs through is cut into lines and joined again around the marker
  it.each([
    ":::toggle\nfirst line\n\\==x== literal\n:::\n",
    ":::toggle\n\\==x== literal\nsecond line\n:::\n",
    ":::toggle\nabc\n:::\nfoo\n\\==x== literal\n",
    ":::tabs\n=== A\nfirst line\n\\==x== literal\n:::\n",
    ":::columns\n:::column\nfirst line\n\\==x== literal\n:::\n:::\n",
  ])("takes a backslash on a line beside a `:::` line in %j as the person's text", (text) => {
    const item = imported(text);
    expect(item.annotations).toStrictEqual({});
    expect(JSON.stringify(item.blocks)).toContain("==x== literal");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a comment and a ref a backslash wrote beside a `:::` line as words", () => {
    const item = imported(":::toggle\nabc\n:::\nfoo \\%%c%%\nbar \\^abc\n");
    expect(item.blocks.map(({ block }) => block.ref)).toStrictEqual([undefined, undefined]);
    const stored = JSON.stringify(item.blocks);
    expect(stored).not.toContain('"type":"opaque"');
    expect(stored).toContain("foo %%c%%\\nbar ^abc");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads none of them inside a link's words or a code span", () => {
    const item = imported("[==a== %%b%%](https://example.com) and `==c== %%d%%`\n");
    expect(item.annotations).toStrictEqual({});
    expect(JSON.stringify(item.blocks)).not.toContain('"type":"opaque"');
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a ref on a block a person emptied, and a second ref as the words it is", () => {
    const emptied = typedItem("note", [
      typedLine("Above.", "above"),
      { children: [{ text: "" }], id: "empty", ref: "kept", type: "p" },
    ]);
    expect(content(reimported(emptied))).toStrictEqual(content(emptied));
    const twice = imported("Named. ^one\n\n^two\n");
    expect(twice.blocks.map(({ block }) => [block.ref, block.children])).toStrictEqual([
      ["one", [{ text: "Named." }]],
      [undefined, [{ text: "^two" }]],
    ]);
    expect(content(reimported(twice))).toStrictEqual(content(twice));
  });
});

// the canonical files whose body an import changes, each by what it changes and why; every other
// one exports its body byte for byte
const SETTLED_ON_IMPORT = new Map<string, (text: string) => string>([
  // YAML no field can read is no field's: it moves into the note as its first code block, where
  // the person can see and mend it
  [
    "frontmatter/invalid.md",
    (text) =>
      `\`\`\`yaml\n${FRONTMATTER_RE.exec(text)?.groups?.yaml ?? ""}\n\`\`\`\n\n${bodyOf(text)}`,
  ],
  // the library holds a file a note embeds as an image, and an image is a block, so an embed
  // inside a paragraph splits it where it stood
  [
    "canonical/kitchen-sink.md",
    (text) =>
      bodyOf(text).replace(
        " plus ![[embed.png]] inline.",
        " plus&#x20;\n\n![](embed.png)\n\n&#x20;inline.",
      ),
  ],
  // a link names its item by the title the resolver reads, its padding trimmed, and an embedded
  // image keeps its width as the image the editor writes it as
  [
    "canonical/wiki-edges.md",
    (text) =>
      bodyOf(text)
        .replace("[[ padded ]]", "[[padded]]")
        .replace("![[img.png|300]]", "![|300](img.png)"),
  ],
]);

describe("today's markdown imports losslessly", () => {
  it.each(fixtures().filter((one) => !one.name.startsWith("churn/")))("$name", (fixture) => {
    const settle = SETTLED_ON_IMPORT.get(fixture.name) ?? bodyOf;
    expect(bodyOf(exported(imported(fixture.text)).text)).toBe(settle(fixture.text));
  });

  it("names only fixtures an import changes", () => {
    for (const [name, settle] of SETTLED_ON_IMPORT) {
      const text = fixtures().find((one) => one.name === name)?.text;
      expect(text, name).toBeDefined();
      expect(settle(text ?? ""), name).not.toBe(bodyOf(text ?? ""));
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

  it("keeps what a field's key holds that the field cannot read, and writes the key once", () => {
    const item = imported(
      [
        "---",
        "tags: [work, reading list, 2026]",
        "aliases: 3",
        "pinned: yes",
        "fetched: someday",
        "kind: 3",
        "---",
        "",
        "Body.",
        "",
      ].join("\n"),
    );
    expect(item.fields).toMatchObject({
      aliases: [],
      fetchedAt: null,
      pinnedAt: null,
      properties: {
        aliases: 3,
        fetched: "someday",
        kind: 3,
        pinned: "yes",
        tags: ["reading list", 2026],
      },
      tags: ["work"],
    });
    const written = exported(item).text;
    expect(written.match(/^tags:/gmu)).toHaveLength(1);
    expect(written).toContain("tags:\n  - work\n  - reading list\n  - 2026\n");
    expect(content(reimported(item))).toStrictEqual(content(item));
    // a field the person set later wins its key over a property of the same name
    const pinned = exported({ ...item, fields: { ...item.fields, pinnedAt: CODEC_NOW } }).text;
    expect(pinned.match(/^pinned:/gmu)).toStrictEqual(["pinned:"]);
    expect(pinned).toContain("pinned: true");
  });

  it("keeps a block that is not YAML as the note's first code block", () => {
    const item = imported("---\nkey: [unclosed\n---\n\nBody.\n");
    expect(item.fields.kind).toBe("note");
    expect(item.blocks.map(({ block }) => block.type)).toStrictEqual(["code_block", "p"]);
    expect(JSON.stringify(item.blocks[0]?.block)).toContain("key: [unclosed");
  });

  // its input is past the 512 KiB block cap, and parsing that much markdown takes seconds on a
  // runner beside the other suites
  it(
    "cuts a block past the cap into blocks of its own type, its text kept whole",
    { timeout: 30_000 },
    () => {
      const line = "A long line of a pasted log, written again and again.";
      const lines = Array.from(
        { length: Math.ceil((BLOCK_MAX_BYTES * 1.5) / line.length) },
        () => line,
      );
      const item = imported(`\`\`\`\n${lines.join("\n")}\n\`\`\`\n`);
      expect(item.leftOut).toBe(0);
      expect(item.blocks.length).toBeGreaterThan(1);
      expect(new Set(item.blocks.map(({ block }) => block.type))).toStrictEqual(
        new Set(["code_block"]),
      );
      const text = item.blocks
        .flatMap(({ block }) => block.children)
        .map((child) => /"text":"(?<text>[^"]*)"/u.exec(JSON.stringify(child))?.groups?.text ?? "")
        .filter((piece) => piece !== "");
      expect(text).toStrictEqual(lines);
    },
  );

  it("cuts one long run of text between characters, never inside a surrogate pair", () => {
    // an odd offset puts a pair's high half at the cut
    const run = `x${"😀".repeat(140_000)}`;
    const item = imported(`${run}\n`);
    expect(item.blocks.length).toBeGreaterThan(1);
    const pieces = item.blocks
      .flatMap(({ block }) => block.children)
      .flatMap((child) => ("text" in child ? [child.text] : []));
    expect(pieces.join("")).toBe(run);
    // a lone surrogate, which UTF-8 cannot hold
    expect(pieces.filter((piece) => /\p{Cs}/u.test(piece))).toStrictEqual([]);
  });

  it("keeps the words of a link and the source of an image that name no address", () => {
    const item = imported(
      "Before [words]() after.\n\n- ![seen]()\n- [listed]()\n\n> [quoted](<>)\n\n| a |\n| - |\n| [cell]() |\n",
    );
    expect(item.leftOut).toBe(0);
    const stored = JSON.stringify(item.blocks);
    for (const kept of ["Before ", "words", " after.", "![seen]()", "listed", "quoted", "cell"]) {
      expect(stored).toContain(kept);
    }
    expect(stored).not.toContain('"type":"a"');
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("counts what it left out: a block no item can hold, a store it cannot read", () => {
    const fence = `\`\`\`inteligir-html\n${"x".repeat(BLOCK_MAX_BYTES)}\n\`\`\`\n`;
    const text = `Kept.\n\n${fence}`;
    const item = imported(text);
    expect(item.leftOut).toBe(1);
    expect(JSON.stringify(item.blocks)).toContain("Kept.");
    expect(imported("Some text.\n", "{ not json").leftOut).toBe(1);
  });

  it("reads the highlights' markers and their store", () => {
    const text = "Some %%i:h1:start%%marked words%%i:h1:end%% here.\n";
    const store = JSON.stringify({
      h1: { createdAt: 1, quote: "marked words", source: "user", text: "why", updatedAt: 1 },
    });
    const item = imported(text, store);
    expect(Object.keys(item.annotations)).toStrictEqual(["h1"]);
    expect(JSON.stringify(item.blocks)).toContain('"type":"annotationMarker"');
    expect(imported(text, "{ not json").annotations).toStrictEqual({});
  });
});
