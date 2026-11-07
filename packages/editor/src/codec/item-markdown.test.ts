import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StoredBlock } from "@repo/notes/library/block-ops";
import { blockHash } from "@repo/notes/library/block-hash";
import { ordsBetween } from "@repo/notes/library/block-order";
import { BLOCK_MAX_BYTES, LIST_MAX_INDENT } from "@repo/notes/library/library-nodes";
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

  it.each([
    ["a comment", String.raw`%%y\|z%%`],
    ["a pair of tags", String.raw`<kbd>x\|y</kbd>`],
    // a tag holds its source as written, so its escape is already there
    ["a tag", String.raw`<b title="x\|y">`],
  ])("keeps the pipe of %s in a table cell in its cell", (_name, cell) => {
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(bodyOf(exported(item).text)).toContain(`| ${cell} |`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads a comment whose pipe a table cell escapes as the comment it is", () => {
    const item = imported(String.raw`| a |
| - |
| %%y\|z%% |
`);
    expect(JSON.stringify(item.blocks)).toContain('"source":"%%y|z%%"');
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

const types = (item: ImportedItem): string[] => item.blocks.map(({ block }) => block.type);

const labels = (item: ImportedItem): string[] =>
  item.blocks.flatMap(({ block }) =>
    block.type === "tab_group"
      ? block.children.flatMap((panel) =>
          "type" in panel && panel.type === "tab_panel" ? [panel.label] : [],
        )
      : [],
  );

describe("a block a list item opens with", () => {
  const WEB_IMAGE = "![](https://a.b/c.png)";

  it.each([
    ["a bullet", `- ${WEB_IMAGE}\n`, ["media_embed"]],
    ["a bullet among others", `- first\n- ${WEB_IMAGE}\n- third\n`, ["p", "media_embed", "p"]],
    ["a numbered item", `1. first\n2. ${WEB_IMAGE}\n`, ["p", "media_embed"]],
    ["a nested item", `- a\n  - ${WEB_IMAGE}\n`, ["p", "media_embed"]],
    ["words either side", `- text ${WEB_IMAGE} more\n`, ["p", "media_embed", "p"]],
    ["an item's next line", `- ${WEB_IMAGE}\n  more\n`, ["media_embed", "p"]],
    ["a to-do", `- [ ] ${WEB_IMAGE}\n`, ["p", "media_embed"]],
    ["a done to-do", `- [x] ${WEB_IMAGE}\n`, ["p", "media_embed"]],
  ])("keeps a web image's address in %s", (_name, text, blocks) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(blocks);
    expect(bodyOf(exported(item).text)).toContain(WEB_IMAGE);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["video", "![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)"],
    ["file", "![](https://a.b/c.pdf)"],
  ])("keeps a web %s in a bullet as the embed it is", (type, embed) => {
    const item = imported(`- ${embed}\n`);
    expect(types(item)).toStrictEqual([type]);
    expect(bodyOf(exported(item).text)).toBe(`${embed}\n`);
  });

  it("keeps the words either side of an image in order, each in the list", () => {
    const item = imported(`- text ${WEB_IMAGE} more\n`);
    expect(item.blocks.map(({ block }) => JSON.stringify(block.children))).toStrictEqual([
      '[{"text":"text "}]',
      '[{"text":""}]',
      '[{"text":" more"}]',
    ]);
  });

  it.each([
    [false, "[ ]"],
    [true, "[x]"],
  ])("keeps a to-do's box, checked %s, on a line above what it held", (checked, box) => {
    const [line, embed] = imported(`- ${box} ${WEB_IMAGE}\n`).blocks.map(({ block }) => block);
    expect(line).toMatchObject({ checked, indent: 1, listStyleType: "todo", type: "p" });
    expect(embed).toMatchObject({ type: "media_embed", url: "https://a.b/c.png" });
  });

  it("numbers the items after one a block took out of the list as they were", () => {
    const item = imported(`1. first\n2. ${WEB_IMAGE}\n3. third\n`);
    expect(bodyOf(exported(item).text)).toBe(`1. first\n\n${WEB_IMAGE}\n\n3. third\n`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["a fence", "- ```\n  kept\n  ```\n", "code_block"],
    ["a chart", '- ```inteligir-chart\n  {"kept":1}\n  ```\n', "chart_block"],
    ["an equation", "- $$\n  kept\n  $$\n", "equation"],
    ["a quote", "- > kept\n", "blockquote"],
    ["a table", "- | kept |\n  | ---- |\n  | also |\n", "table"],
    ["a toggle", "- :::toggle\n  kept\n  :::\n", "toggle"],
    ["tabs", "- :::tabs\n  === One\n  kept\n  :::\n", "tab_group"],
    ["columns", "- :::columns\n  :::column\n  kept\n  :::\n  :::\n", "column_group"],
  ])("keeps %s an item opens with as the block it is", (_name, text, type) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual([type]);
    expect(JSON.stringify(item.blocks)).toContain("kept");
    expect(bodyOf(exported(item).text)).toContain("kept");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["bullet", "disc"],
    ["numbered item", "decimal"],
  ] as const)("keeps an empty %s above the list nested under it", (_name, listStyleType) => {
    const number = listStyleType === "decimal" ? { listStart: 1 } : {};
    const typed = typedItem("note", [
      { children: [{ text: "" }], id: "a", indent: 1, listStyleType, type: "p", ...number },
      { children: [{ text: "b" }], id: "b", indent: 2, listStyleType, type: "p", ...number },
    ]);
    expect(content(reimported(typed))).toStrictEqual(content(typed));
  });

  it("nests a list an item opens with under that item's empty line, its to-dos kept", () => {
    const item = imported("- - [ ] a\n  - [x] b\n- c\n");
    expect(bodyOf(exported(item).text)).toBe("-\n  - [ ] a\n  - [x] b\n- c\n");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a heading an item opens with as the item's words", () => {
    const item = imported("- # kept\n");
    expect(types(item)).toStrictEqual(["p"]);
    expect(bodyOf(exported(item).text)).toBe("- kept\n");
  });
});

describe("a list as deep as an item holds", () => {
  const SPELLINGS = [
    ["a line of openers", (depth: number) => `${"- ".repeat(depth)}x\n`],
    [
      "items nested one in another",
      (depth: number) =>
        `${Array.from({ length: depth }, (_, at) => `${"  ".repeat(at)}- x`).join("\n")}\n`,
    ],
  ] as const;

  it.each(SPELLINGS)("lands at the limit and comes back, as %s", (_name, text) => {
    const item = imported(text(LIST_MAX_INDENT));
    expect(item.leftOut).toBe(0);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each(SPELLINGS)("is refused one level past it, as %s", (_name, text) => {
    expect(
      importItem(
        { annotations: null, name: "Deep", text: text(LIST_MAX_INDENT + 1) },
        library.importPorts(),
      ),
    ).toStrictEqual({ ok: false, reason: "too-deep" });
  });

  it("refuses a block nested under an item at the last level", () => {
    const text = `${"- ".repeat(LIST_MAX_INDENT)}x\n\n${"  ".repeat(LIST_MAX_INDENT)}after\n`;
    expect(
      importItem({ annotations: null, name: "Deep", text }, library.importPorts()),
    ).toStrictEqual({ ok: false, reason: "too-deep" });
  });
});

describe("a reference and its definition", () => {
  const WRITTEN = "[design doc](https://example.com/doc)";
  const BOTH = [
    "Read the [design doc][1] before [the meeting][m] on Friday.",
    "",
    "[1]: https://example.com/doc",
    "[m]: https://example.com/meet",
    "",
  ].join("\n");

  it("reads a reference as the link it names, its words and its address kept", () => {
    const item = imported(BOTH);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(["p"]);
    expect(bodyOf(exported(item).text)).toBe(
      `Read the ${WRITTEN} before [the meeting](https://example.com/meet) on Friday.\n`,
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
    expect(content(reimported(reimported(item)))).toStrictEqual(content(item));
  });

  it.each([
    ["a collapsed one", "[design doc][]\n\n[design doc]: https://example.com/doc\n"],
    ["a shortcut", "[design doc]\n\n[design doc]: https://example.com/doc\n"],
    ["one whose label differs in case", "[design doc][DOC]\n\n[doc]: https://example.com/doc\n"],
    [
      "one above which its definition stands",
      "[doc]: https://example.com/doc\n\n[design doc][doc]\n",
    ],
    ["one in a list", "- [design doc][1]\n\n[1]: https://example.com/doc\n"],
    ["one in a quote", "> [design doc][1]\n\n[1]: https://example.com/doc\n"],
    ["one in a heading", "# [design doc][1]\n\n[1]: https://example.com/doc\n"],
    ["one in a table", "| a |\n| - |\n| [design doc][1] |\n\n[1]: https://example.com/doc\n"],
    ["one in a toggle", ":::toggle\n[design doc][1]\n:::\n\n[1]: https://example.com/doc\n"],
    ["one in a tab", ":::tabs\n=== A\n[design doc][1]\n:::\n\n[1]: https://example.com/doc\n"],
    ["one whose definition sits in a quote", "[design doc][1]\n\n> [1]: https://example.com/doc\n"],
  ])("reads %s", (_name, text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(bodyOf(exported(item).text)).toContain(WRITTEN);
    expect(bodyOf(exported(item).text)).not.toContain("]: ");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["an image with words", "![chart][c]", "https://example.com/c.png", "img"],
    ["an image a folder holds", "![chart][c]", "pic.png", "img"],
    ["an image with no words", "![][c]", "https://example.com/c.png", "media_embed"],
    ["a video with no words", "![][c]", "https://www.youtube.com/watch?v=dQw4w9WgXcQ", "video"],
  ])("reads %s as a markdown image of that address reads", (_name, written, url, type) => {
    const item = imported(`${written}\n\n[c]: ${url}\n`);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual([type]);
    const alt = written.startsWith("![]") ? "" : "chart";
    expect(bodyOf(exported(item).text)).toBe(`![${alt}](${url})\n`);
    expect(content(item)).toStrictEqual(content(imported(`![${alt}](${url})\n`)));
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a link's own title, which a bare address cannot spell", () => {
    const text =
      '[a](https://example.com "Kept")\n\n[https://example.com](https://example.com "Too")\n';
    const item = imported(text);
    expect(bodyOf(exported(item).text)).toBe(text);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a definition's title on the link and the image that use it", () => {
    const item = imported(
      '[a][l] and\n\n![b][i]\n\n[l]: https://example.com "Link title"\n[i]: https://example.com/i.png "Image title"\n',
    );
    expect(bodyOf(exported(item).text)).toBe(
      '[a](https://example.com "Link title") and\n\n![b](https://example.com/i.png "Image title")\n',
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps the words of a reference to no address, and the source of an image of one", () => {
    const item = imported("[words][b] and\n\n![seen][b]\n\n[b]: <>\n");
    expect(item.leftOut).toBe(0);
    const stored = JSON.stringify(item.blocks);
    expect(stored).toContain("words");
    expect(stored).toContain("![seen]()");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads a reference in a page by a definition in the note, and the other way", () => {
    const item = imported(
      "[note words][n]\n\n[p]: https://example.com/p\n\n:::article\n[page words][p]\n\n[n]: https://example.com/n\n:::\n",
    );
    expect(bodyOf(exported(item).text)).toBe(
      "[note words](https://example.com/n)\n\n:::article\n[page words](https://example.com/p)\n:::\n",
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["nothing used", "Body.\n\n[orphan]: https://example.com\n"],
    ["nothing used, with a title", 'Body.\n\n[orphan]: https://example.com "Kept"\n'],
    ["alone in a file", "[orphan]: https://example.com\n"],
    ["in a list", "- a\n\n  [orphan]: https://example.com\n"],
    ["opening a list item", "- [orphan]: https://example.com\n"],
    ["in a quote", "> a\n>\n> [orphan]: https://example.com\n"],
    ["opening a toggle", ":::toggle\n\n[orphan]: https://example.com\n:::\n"],
    ["opening a tab", ":::tabs\n=== A\n\n[orphan]: https://example.com\n:::\n"],
    ["opening a column", ":::columns\n:::column\n\n[orphan]: https://example.com\n:::\n:::\n"],
  ])("keeps a definition %s as its line", (_name, text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(JSON.stringify(item.blocks)).toContain('"source":"[orphan]: https://example.com');
    expect(bodyOf(exported(item).text)).toContain("[orphan]: https://example.com");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a definition that opens a toggle one, whatever its label escapes", () => {
    const item = imported(":::toggle\n\n[a\\]b]: https://example.com\n\nBody.\n:::\n");
    expect(bodyOf(exported(item).text)).toBe(
      ":::toggle\n\n[a\\]b]: https://example.com\n\nBody.\n:::\n",
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a container a definition opens a container", () => {
    const item = imported(":::toggle\n\n[orphan]: https://example.com\n\nBody.\n:::\n");
    expect(types(item)).toStrictEqual(["toggle"]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("uses the first definition of a label and keeps the next as its line", () => {
    const item = imported("[a][b]\n\n[b]: https://example.com/one\n[b]: https://example.com/two\n");
    expect(bodyOf(exported(item).text)).toBe(
      "[a](https://example.com/one)\n\n[b]: https://example.com/two\n",
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps text a person typed beside a definition held as its line as text", () => {
    const held = imported("[b]: https://example.com\n");
    const typed = typedItem("note", [
      typedLine("[b] and [a][b] are words", "words"),
      typedLine("[x]: /a/path", "line"),
      ...held.blocks.map(({ block }) => block),
    ]);
    expect(content(reimported(typed))).toStrictEqual(content(typed));
  });
});

describe("an equation's fence line", () => {
  it("leads the expression, since an equation has nowhere else to hold it", () => {
    const item = imported("$$ E = mc^2\n+ x\n$$\n");
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(["equation"]);
    expect(bodyOf(exported(item).text)).toBe("$$\nE = mc^2\n+ x\n$$\n");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("is the whole expression of a fence with nothing under it", () => {
    const item = imported("$$ E = mc^2\n$$\n");
    expect(bodyOf(exported(item).text)).toBe("$$\nE = mc^2\n$$\n");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });
});

describe("a footnote", () => {
  const NOTED =
    "Before.\n\nA long para with a claim[^a] and more words.\n\nAfter.\n\n[^a]: the source\n";

  it("rides as its source, and the paragraph it stands in lands", () => {
    const item = imported(NOTED);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(["p", "p", "p", "p"]);
    const stored = JSON.stringify(item.blocks);
    expect(stored).toContain("A long para with a claim");
    expect(stored).toContain(" and more words.");
    expect(stored).toContain('"source":"[^a]"');
    expect(stored).toContain('"source":"[^a]: the source"');
    expect(bodyOf(exported(item).text)).toBe(NOTED);
    expect(content(reimported(item))).toStrictEqual(content(item));
    expect(content(reimported(reimported(item)))).toStrictEqual(content(item));
  });

  it.each([
    ["a line alone", "text[^1] more\n\n[^1]: note\n"],
    ["a heading", "# Title[^1]\n\n[^1]: note\n"],
    ["a list item", "- item one[^1]\n- item two\n\n[^1]: note\n"],
    ["a quote", "> one[^1]\n> two\n\n[^1]: note\n"],
    ["an alert", "> [!NOTE]\n> one[^1]\n\n[^1]: note\n"],
    ["a table", "| a      | b   |\n| ------ | --- |\n| one[^1] | two |\n\n[^1]: note\n"],
    ["a toggle", ":::toggle\none[^1]\n:::\n\n[^1]: note\n"],
    ["a tab", ":::tabs\n=== A\none[^1]\n:::\n\n[^1]: note\n"],
  ])("keeps the words around one in %s", (_name, text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    const body = bodyOf(exported(item).text);
    expect(body).toContain("[^1]");
    expect(body).toContain("[^1]: note");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["ending a toggle", ":::toggle\nBody[^a].\n\n[^a]: the source\n\n:::\n", "toggle"],
    ["alone in a toggle", ":::toggle\n[^a]: the source\n\n:::\n", "toggle"],
    ["ending a tab", ":::tabs\n=== A\nBody[^a].\n\n[^a]: the source\n\n:::\n", "tab_group"],
    [
      "ending a column",
      ":::columns\n:::column\nBody[^a].\n\n[^a]: the source\n\n:::\n:::\n",
      "column_group",
    ],
  ])("keeps a container a definition stands %s in", (_name, text, type) => {
    const item = imported(text);
    expect(types(item)).toStrictEqual([type]);
    expect(bodyOf(exported(item).text)).toBe(text);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a definition of several blocks whole", () => {
    const text = "One[^a].\n\n[^a]: First.\n\n    Second.\n\n    - third\n\nAfter.\n";
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(bodyOf(exported(item).text)).toBe(text);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a definition nothing uses, and a call no definition answers, as their source", () => {
    const item = imported("[^a]: unused\n\nA call[^nothing] alone.\n");
    expect(item.leftOut).toBe(0);
    const body = bodyOf(exported(item).text);
    expect(body).toContain("[^a]: unused");
    expect(body).toContain("A call[^nothing] alone.");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps text a person typed that spells a call as that text", () => {
    const item = typedItem("note", [typedLine("A typed [^a] here.")]);
    expect(bodyOf(exported(item).text).trimEnd()).toBe(String.raw`A typed \[^a] here.`);
    expect(JSON.stringify(reimported(item).blocks)).toContain("A typed [^a] here.");
    expect(content(reimported(item)).blocks).toStrictEqual(content(item).blocks);
  });

  it.each([
    ["[see [^a]](https://example.com) here\n\n[^a]: said\n"],
    ["[see [^a]](https://example.com) here\n"],
    ["**bold [^a] words**\n"],
    ["| a[^b] |\n| - |\n| c[^d] |\n"],
    ["[^a]: see [^b]\n\nOne[^a].\n"],
  ])("holds a call wherever text stands in %j", (text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(bodyOf(exported(item).text)).not.toContain(String.raw`\[^`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads a tab's label past a call it spells", () => {
    const item = imported(":::tabs\n=== See [^a]\nbody\n:::\n");
    expect(item.blocks.map(({ block }) => block.type)).toStrictEqual(["tab_group"]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  // no spelling is read in a held source, so a highlight there writes the escape that says it is text
  it("reads nothing out of what a definition holds", () => {
    const item = imported("One[^a].\n\n[^a]: ==kept== and @2026-08-22 and [[Other]]\n");
    expect(item.annotations).toStrictEqual({});
    expect(bodyOf(exported(item).text)).toContain(
      String.raw`[^a]: \==kept== and @2026-08-22 and [[Other]]`,
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });
});

describe("a tab's label", () => {
  it.each([
    [String.raw`\@2026-08-22`, "@2026-08-22"],
    [String.raw`Due \@2026-08-22`, "Due @2026-08-22"],
    [String.raw`\{{1+1}}`, "{{1+1}}"],
    [String.raw`\%%i:abc:start%%`, "%%i:abc:start%%"],
    [String.raw`\*\*x\*\*`, "**x**"],
    [String.raw`\[\[Note]]`, "[[Note]]"],
    [String.raw`\`x\``, "`x`"],
    ["&lt;b&gt;", "<b>"],
    [String.raw`a\\`, "a\\"],
    ["Plain words", "Plain words"],
  ])("reads `=== %s` back as the label it spells", (written, label) => {
    const item = imported(`:::tabs\n=== First\none\n=== ${written}\ntwo\n:::\n`);
    expect(item.blocks.map(({ block }) => block.type)).toStrictEqual(["tab_group"]);
    expect(labels(item)).toStrictEqual(["First", label]);
    expect(content(reimported(item))).toStrictEqual(content(item));
    expect(content(reimported(reimported(item)))).toStrictEqual(content(item));
  });

  it.each([
    [String.raw`https\://example.com`, "https://example.com"],
    [String.raw`www\.example.com`, "www.example.com"],
    [String.raw`me\@example.com`, "me@example.com"],
    [String.raw`see https\://example.com here`, "see https://example.com here"],
  ])("reads `=== %s`, a bare address a backslash keeps, as its label", (written, label) => {
    const item = imported(`:::tabs\n=== First\none\n=== ${written}\ntwo\n:::\n`);
    expect(types(item)).toStrictEqual(["tab_group"]);
    expect(labels(item)).toStrictEqual(["First", label]);
    expect(bodyOf(exported(item).text)).toContain(`=== ${written}\n`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("writes plain words as they stand, and an escape only where a label needs one", () => {
    const first = imported(":::tabs\n=== Draft 2\none\n=== \\@2026-08-22\ntwo\n:::\n");
    expect(bodyOf(exported(first).text)).toBe(
      ":::tabs\n=== Draft 2\none\n\n=== \\@2026-08-22\ntwo\n:::\n",
    );
  });

  it.each([
    "@2026-08-22",
    "**x**",
    "[[Note]]",
    "`x`",
    "https://example.com",
    "www.example.com",
    "me@example.com",
    String.raw`[a\*b](https://example.com/a*b)`,
  ])("keeps `=== %s`, which is no plain words, as the lines of text it is", (written) => {
    const item = imported(`:::tabs\n=== ${written}\nbody\n:::\n`);
    expect(item.blocks.map(({ block }) => block.type)).toStrictEqual(["p"]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });
});

describe("one file's `title:`", () => {
  it.each([
    ['title: ""', ""],
    ['title: "   "', ""],
    ["title: Home", "Home"],
  ])("reads %s as the item's title and leaves no property", (line, title) => {
    const { fields } = imported(`---\n${line}\n---\nGroceries\n`);
    expect(fields).toMatchObject({ properties: {}, title });
  });

  it("gives way to the file's name where it holds no text, and stays a property", () => {
    const { fields } = imported("---\ntitle:\n---\nGroceries\n");
    expect(fields).toMatchObject({ properties: { title: null }, title: "Fixture" });
  });
});

// what the table writer spells an empty paragraph with, an empty cell's as a line's
const EMPTY_CELL_LINE = "\u200B";

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

  it.each([
    [String.raw`[[Other\|shown]]`, String.raw`[[Other\|shown]]`],
    [String.raw`![[Other\|300]]`, String.raw`![[Other\|300]]`],
    ["[[Other]]", "[[Other]]"],
    [String.raw`[[a\\\|shown]]`, String.raw`[[a\\\|shown]]`],
    [String.raw`$$\|x\|$$`, String.raw`$$\|x\|$$`],
    [String.raw`$$a\\\|b$$`, String.raw`$$a\\\|b$$`],
    [String.raw`*$$\|x\|$$*`, String.raw`$$\|x\|$$`],
  ])("reads %s in a cell by the table's spelling, and writes it so", (cell, written) => {
    const item = imported(`| a | b |\n| - | - |\n| ${cell} | word |\n`);
    expect(item.leftOut).toBe(0);
    expect(exported(item).text).toContain(`| ${written} |`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["between words", "see ![icon](https://x.cd/p.png) here"],
    ["after words", "see ![icon](https://x.cd/p.png)"],
    ["before words", "![icon](https://x.cd/p.png) here"],
    ["beside another", "![one](https://x.cd/1.png)![two](https://x.cd/2.png)"],
    ["a word from another", "![one](https://x.cd/1.png) and ![two](https://x.cd/2.png)"],
    ["held by a mark", "see **![icon](https://x.cd/p.png)** here"],
    ["beside the writer's own break", "see<br/>![icon](https://x.cd/p.png)<br/>here"],
    ["that is a file's embed", "see ![[shot.png]] here"],
    ["that is two files' embeds", "![[one.png]] and ![[two.png]]"],
  ])("stands an image %s alone in its cell, and its bytes hold still", (_name, cell) => {
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(item.leftOut).toBe(0);
    expect(JSON.stringify(item.blocks)).not.toContain('"source"');
    const again = reimported(item);
    expect(content(again)).toStrictEqual(content(item));
    expect(exported(reimported(again)).text).toBe(exported(item).text);
  });

  it.each([
    ["two words", "one<br/>two", ["one", "two"]],
    ["a held mark's words", "**one<br/>two**", ["one", "two"]],
    ["an empty line", "one<br/><br/>two", ["one", EMPTY_CELL_LINE, "two"]],
    ["a cell's edges", "<br/>one<br/>", [EMPTY_CELL_LINE, "one", EMPTY_CELL_LINE]],
    ["nothing but a break", "<br/>", [EMPTY_CELL_LINE, EMPTY_CELL_LINE]],
  ])("reads a `<br/>` between %s as the cell's next line", (_name, cell, lines) => {
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(item.leftOut).toBe(0);
    const written = JSON.stringify(item.blocks);
    expect(written).not.toContain('"source"');
    expect(
      [...written.matchAll(/"text":"(?<text>[^"]*)"/gu)].map(([, text]) => text),
    ).toStrictEqual(["a", ...lines]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a tag in another spelling, or text spelling one, as it stands", () => {
    const item = imported(String.raw`| a |
| - |
| one<br>two |
| one\<br/>two |
`);
    expect(JSON.stringify(item.blocks)).toContain('"source":"<br>"');
    expect(JSON.stringify(item.blocks)).toContain('"text":"one<br/>two"');
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("writes a code span's own backslash before a pipe so the row stands", () => {
    const item = typedItem("note", [
      {
        children: [
          {
            children: [
              {
                children: [{ children: [{ code: true, text: String.raw`a\|b` }], type: "p" }],
                type: "td",
              },
              { children: [{ children: [{ text: "word" }], type: "p" }], type: "td" },
            ],
            type: "tr",
          },
        ],
        id: "t",
        type: "table",
      },
    ]);
    expect(exported(item).text).toContain(String.raw`| ${"`"}a\\\|b${"`"} | word |`);
    const again = reimported(item);
    expect(JSON.stringify(again.blocks).match(/"type":"t[dh]"/gu)).toHaveLength(2);
    expect(exported(again).text).toBe(exported(reimported(again)).text);
  });

  it("writes TeX's own double bar in a cell so it stays one", () => {
    const item = typedItem("note", [
      {
        children: [
          {
            children: [
              {
                children: [
                  {
                    children: [
                      { text: "" },
                      {
                        children: [{ text: "" }],
                        texExpression: String.raw`\|x\|`,
                        type: "inline_equation",
                      },
                      { text: "" },
                    ],
                    type: "p",
                  },
                ],
                type: "td",
              },
            ],
            type: "tr",
          },
        ],
        id: "t",
        type: "table",
      },
    ]);
    expect(exported(item).text).toContain(String.raw`$$\Vert x\Vert $$`);
    expect(JSON.stringify(reimported(item).blocks)).toContain(String.raw`\\Vert x\\Vert `);
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

  it.each([
    ['![alt](<> "some title")\n', '![alt](<> "some title")'],
    ['[words](<> "some title")\n', '[words](<> "some title")'],
    ['[*fine* words](<> "some title")\n', '[*fine* words](<> "some title")'],
    ['[r]\n\n[r]: <> "emptytitle"\n', '[r](<> "emptytitle")'],
    ['![r][r]\n\n[r]: <> "emptytitle"\n', '![r](<> "emptytitle")'],
    ['[![alt](<> "some title")](https://example.com)\n', '![alt](<> "some title")'],
    [
      String.raw`| [words](<> "a\|b") |
| - |
`,
      String.raw`[words](<> "a\|b")`,
    ],
  ])("keeps the title of what names no address in %j", (text, source) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(bodyOf(exported(item).text)).toContain(source);
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
