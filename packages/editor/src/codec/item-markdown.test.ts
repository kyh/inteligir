import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import type { StoredBlock } from "@repo/contract/library/block-ops";
import { blockHash } from "@repo/contract/library/block-hash";
import { ordsBetween } from "@repo/contract/library/order-key";
import { BLOCK_MAX_BYTES, LIST_MAX_INDENT } from "@repo/contract/library/library-nodes";
import type { LibraryBlock, LibrarySection } from "@repo/contract/library/library-nodes";

import { generateDoc } from "../test-support/markdown-doc-generator";
import { CODEC_NOW, pretendLibrary, withoutId } from "../test-support/codec-ports";
import { exportItem, importItem } from "./item-markdown";
import type { ImportedItem } from "./item-markdown";

const FIXTURES = fileURLToPath(new URL("../test-support/fixtures/", import.meta.url));

const fixtures = (): { name: string; text: string }[] =>
  (["corpus", "frontmatter"] as const).flatMap((dir) =>
    readdirSync(`${FIXTURES}${dir}`)
      .toSorted()
      .map((file) => ({
        name: `${dir}/${file}`,
        text: readFileSync(`${FIXTURES}${dir}/${file}`, "utf-8"),
      })),
  );

const library = pretendLibrary();

const imported = (text: string, name = "Fixture"): ImportedItem => {
  const read = importItem({ name, text }, library.importPorts());
  if (!read.ok) {
    throw new Error(`the import refused: ${read.reason}`);
  }
  return read.item;
};

const exported = (item: ImportedItem): { text: string } =>
  exportItem(
    {
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
const reimported = (item: ImportedItem): ImportedItem =>
  imported(exported(item).text, item.fields.title);

// what an item is, ids aside
const content = (item: ImportedItem) => ({
  blocks: item.blocks.map((placed) => ({ ...placed, block: withoutId(placed.block) })),
  fields: item.fields,
  leftOut: item.leftOut,
});

const FRONTMATTER_RE = /^---\n(?<yaml>[\s\S]*?)\n---\n(?:\n|$)/u;

// a file's body, its frontmatter aside: what the person wrote below it
const bodyOf = (text: string): string => text.replace(FRONTMATTER_RE, "");

// an item as the editor stores it, each block what a person typed, whatever its text spells
const typedItem = (section: LibrarySection, blocks: readonly LibraryBlock[]): ImportedItem => {
  const ords = ordsBetween(null, null, blocks.length);
  return {
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

const types = (item: ImportedItem): string[] => item.blocks.map(({ block }) => block.type);

const stored = (item: ImportedItem): string => JSON.stringify(item.blocks);

// a file whose first read holds what its write cannot spell: a space at a mark's edge, which the
// writer moves outside the mark
const SETTLES_ON_FIRST_WRITE = new Set(["corpus/wiki-in-bold.md"]);

describe("import(export(v)) is v, ids aside", () => {
  it.each(fixtures())("$name", (fixture) => {
    const first = imported(fixture.text);
    expect(first.leftOut).toBe(0);
    const settled = SETTLES_ON_FIRST_WRITE.has(fixture.name) ? reimported(first) : first;
    expect(content(reimported(settled))).toStrictEqual(content(settled));
    expect(exported(reimported(first)).text).toBe(exported(first).text);
  });

  it("settles only the files in its list on their first write", () => {
    const settling = fixtures()
      .filter((fixture) => {
        const first = imported(fixture.text);
        return JSON.stringify(content(reimported(first))) !== JSON.stringify(content(first));
      })
      .map((fixture) => fixture.name);
    expect(new Set(settling)).toStrictEqual(SETTLES_ON_FIRST_WRITE);
  });

  // the editor's own seeded documents: all seeds in one test, as its round-trip property runs them
  it("holds over the editor's generated documents", { timeout: 60_000 }, () => {
    for (let seed = 20_261_027; seed < 20_261_027 + 24; seed += 1) {
      const first = imported(generateDoc(seed));
      expect(content(reimported(first)), `seed ${String(seed)}`).toStrictEqual(content(first));
    }
  });

  it("reads a file saved with CRLF line endings as the same file with LF", () => {
    const lf = "---\ntags: [a]\n---\n\n# Title\n\nOne\ntwo\n\n- item\n";
    expect(content(imported(lf.replaceAll("\n", "\r\n")))).toStrictEqual(content(imported(lf)));
  });
});

describe("Obsidian's spellings and the dialect's look-alikes, typed as text", () => {
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
    "[[Note]] and ![[pic.png]]",
    ":date[2026-08-22]",
    ':formula[2]{source="1+1"}',
    ":::toggle",
    "10:30 and a:b",
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
      ":",
      "[",
      "]",
      "\\",
      "==x==",
      "%%c%%",
      " ^r",
      ":date",
      "{",
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

  it.each(LOOK_ALIKES)("keeps %j, typed first in a to-do, as the text it is", (text) => {
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
  });

  it("writes Obsidian's spellings with no escape, since nothing reads them", () => {
    for (const text of ["x==1==y", "50%% and 60%%", "area is r ^2", "^abc", "a == b, 2 ^ 3"]) {
      expect(typedBody(text)).toBe(`${text}\n`);
    }
  });

  it("reads a highlight, a comment and a ref in a file as the text they spell", () => {
    const first = imported("An ==important== line %%not shown%% here. ^goal\n\n- an item ^item\n");
    expect(types(first)).toStrictEqual(["p", "p"]);
    expect(stored(first)).toContain('"text":"An ==important== line %%not shown%% here. ^goal"');
    expect(stored(first)).toContain('"text":"an item ^item"');
    expect(content(reimported(first))).toStrictEqual(content(first));
  });

  it("takes a backslash in a hand-written file as the person's text", () => {
    const item = imported("\\==kept== and a \\%%comment%% then a \\^ref\n\n\\^own\n");
    expect(item.blocks.map(({ block }) => block.children)).toStrictEqual([
      [{ text: "==kept== and a %%comment%% then a ^ref" }],
      [{ text: "^own" }],
    ]);
  });

  it.each([
    ":::toggle\nfirst line\n\\==x== literal\n:::\n",
    ":::toggle\n\\==x== literal\nsecond line\n:::\n",
    ":::toggle\nabc\n:::\nfoo\n\\==x== literal\n",
    "::::tabs\n:::tab[A]\nfirst line\n\\==x== literal\n:::\n::::\n",
    "::::columns\n:::column\nfirst line\n\\==x== literal\n:::\n::::\n",
  ])("takes a backslash on a line beside a `:::` line in %j as the person's text", (text) => {
    const item = imported(text);
    expect(stored(item)).toContain("==x== literal");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("answers a file nested past what a read holds as too deep", () => {
    for (const depth of [3000, 6000, 12_000]) {
      const text = `${"> ".repeat(depth)}x\n`;
      expect(importItem({ name: "Deep", text }, library.importPorts())).toStrictEqual({
        ok: false,
        reason: "too-deep",
      });
    }
  });
});

describe("a block a list item opens with", () => {
  const WEB_IMAGE = "![](https://a.b/c.png)";

  it.each([
    ["a bullet", `- ${WEB_IMAGE}\n`, ["p", "media_embed"]],
    ["a bullet among others", `- first\n- ${WEB_IMAGE}\n- third\n`, ["p", "p", "media_embed", "p"]],
    ["a numbered item", `1. first\n2. ${WEB_IMAGE}\n`, ["p", "p", "media_embed"]],
    ["a nested item", `- a\n  - ${WEB_IMAGE}\n`, ["p", "p", "media_embed"]],
    ["words either side", `- text ${WEB_IMAGE} more\n`, ["p", "media_embed", "p"]],
    ["an item's next line", `- ${WEB_IMAGE}\n  more\n`, ["p", "media_embed", "p"]],
    ["a to-do", `- [ ] ${WEB_IMAGE}\n`, ["p", "media_embed"]],
    ["a done to-do", `- [x] ${WEB_IMAGE}\n`, ["p", "media_embed"]],
  ])("keeps a web image's address in %s, nested under the item's line", (_name, text, blocks) => {
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
    expect(types(item)).toStrictEqual(["p", type]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    [false, "[ ]"],
    [true, "[x]"],
  ])("keeps a to-do's box, checked %s, on the line above what it held", (checked, box) => {
    const [line, embed] = imported(`- ${box} ${WEB_IMAGE}\n`).blocks.map(({ block }) => block);
    expect(line).toMatchObject({ checked, indent: 1, listStyleType: "todo", type: "p" });
    expect(embed).toMatchObject({ indent: 2, type: "media_embed", url: "https://a.b/c.png" });
  });

  it.each([
    ["a fence", "- ```\n  kept\n  ```\n", "code_block"],
    ["a chart", '- ```inteligir-chart\n  {"kept":1}\n  ```\n', "chart_block"],
    ["an equation", "- $$\n  kept\n  $$\n", "equation"],
    ["a quote", "- > kept\n", "blockquote"],
    ["a table", "- | kept |\n  | ---- |\n  | also |\n", "table"],
    ["a toggle", "- :::toggle\n  kept\n  :::\n", "toggle"],
    ["tabs", "- ::::tabs\n  :::tab[One]\n  kept\n  :::\n  ::::\n", "tab_group"],
    ["columns", "- ::::columns\n  :::column\n  kept\n  :::\n  ::::\n", "column_group"],
  ])("nests %s an item opens with under the item's empty line", (_name, text, type) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(["p", type]);
    expect(item.blocks[1]?.block).toMatchObject({ indent: 2 });
    expect(stored(item)).toContain("kept");
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

  it("stands a heading or a quote a person made a list item outside the list", () => {
    const typed = typedItem("note", [
      { children: [{ text: "Head" }], id: "h", indent: 1, listStyleType: "disc", type: "h2" },
      {
        children: [{ children: [{ text: "Quote" }], type: "p" }],
        id: "q",
        indent: 1,
        listStyleType: "disc",
        type: "blockquote",
      },
    ]);
    expect(types(reimported(typed))).toStrictEqual(["h2", "blockquote"]);
    expect(stored(reimported(typed))).not.toContain("listStyleType");
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
      importItem({ name: "Deep", text: text(LIST_MAX_INDENT + 1) }, library.importPorts()),
    ).toStrictEqual({ ok: false, reason: "too-deep" });
  });

  it("refuses a block nested under an item at the last level", () => {
    const text = `${"- ".repeat(LIST_MAX_INDENT)}x\n\n${"  ".repeat(LIST_MAX_INDENT)}after\n`;
    expect(importItem({ name: "Deep", text }, library.importPorts())).toStrictEqual({
      ok: false,
      reason: "too-deep",
    });
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
    [
      "one in a tab",
      "::::tabs\n:::tab[A]\n[design doc][1]\n:::\n::::\n\n[1]: https://example.com/doc\n",
    ],
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
    expect(content(item)).toStrictEqual(content(imported(`![${alt}](${url})\n`)));
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("drops a link's title and a definition's, which no item holds", () => {
    const item = imported(
      '[a](https://example.com "Kept") and [b][l]\n\n[l]: https://example.com/l "Link title"\n',
    );
    expect(bodyOf(exported(item).text)).toBe(
      "[a](https://example.com) and [b](https://example.com/l)\n",
    );
  });

  it("keeps the words of a reference to no address, the source of an image of one, and its line", () => {
    const item = imported("[words][b] and\n\n![seen][b]\n\n[b]: <>\n");
    expect(item.leftOut).toBe(0);
    expect(stored(item)).not.toContain('"type":"a"');
    expect(stored(item)).toContain('"text":"words and"');
    expect(stored(item)).toContain('"text":"![seen]()"');
    expect(stored(item)).toContain('"text":"[b]: <>"');
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads a reference in a page by a definition in the note", () => {
    const item = imported(
      "Note.\n\n[p]: https://example.com/p\n\n:::article\n[page words][p]\n:::\n",
    );
    expect(stored(item)).toContain('"url":"https://example.com/p"');
    expect(bodyOf(exported(item).text)).not.toContain("]: ");
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
    ["opening a tab", "::::tabs\n:::tab[A]\n\n[orphan]: https://example.com\n:::\n::::\n"],
    ["opening a column", "::::columns\n:::column\n\n[orphan]: https://example.com\n:::\n::::\n"],
  ])("reads a definition %s as the text it spells", (_name, text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    expect(stored(item)).toContain(
      '{"text":"[orphan]: "},{"children":[{"text":"https://example.com"}]',
    );
    expect(bodyOf(exported(item).text)).toContain(String.raw`\[orphan]: <https://example.com>`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a container a definition opens a container", () => {
    const item = imported(":::toggle\n\n[orphan]: https://example.com\n\nBody.\n:::\n");
    expect(types(item)).toStrictEqual(["toggle"]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("uses the first definition of a label and reads the next as its text", () => {
    const item = imported("[a][b]\n\n[b]: https://example.com/one\n[b]: https://example.com/two\n");
    expect(bodyOf(exported(item).text)).toBe(
      "[a](https://example.com/one)\n\n\\[b]: <https://example.com/two>\n",
    );
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps text a person typed that spells a reference or a definition as text", () => {
    const typed = typedItem("note", [
      typedLine("[b] and [a][b] are words", "words"),
      typedLine("[x]: /a/path", "line"),
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
  it("lands as its words: the call where it stood, the definition a paragraph of its own", () => {
    const item = imported("A claim[^a] here.\n\n[^a]: the source\n");
    expect(item.leftOut).toBe(0);
    expect(types(item)).toStrictEqual(["p", "p"]);
    expect(bodyOf(exported(item).text)).toBe("A claim\\[^a] here.\n\n\\[^a]: the source\n");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["a heading", "# one[^1]\n\n[^1]: note\n"],
    ["a list item", "- item one[^1]\n- item two\n\n[^1]: note\n"],
    ["a quote", "> one[^1]\n> two\n\n[^1]: note\n"],
    ["an alert", "> [!NOTE]\n> one[^1]\n\n[^1]: note\n"],
    ["a table", "| a      | b   |\n| ------ | --- |\n| one[^1] | two |\n\n[^1]: note\n"],
    ["a tab", "::::tabs\n:::tab[A]\none[^1]\n:::\n::::\n\n[^1]: note\n"],
  ])("keeps the words around one in %s", (_name, text) => {
    const item = imported(text);
    expect(item.leftOut).toBe(0);
    const body = bodyOf(exported(item).text);
    expect(body).toContain(String.raw`one\[^1]`);
    expect(body).toContain(String.raw`\[^1]: note`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a container the definition stands in whole", () => {
    const item = imported(":::toggle\nBody[^a].\n\n[^a]: the source\n:::\n");
    expect(types(item)).toStrictEqual(["toggle"]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps text a person typed that spells a call as that text", () => {
    const item = typedItem("note", [typedLine("A typed [^a] here.")]);
    expect(bodyOf(exported(item).text).trimEnd()).toBe(String.raw`A typed \[^a] here.`);
    expect(content(reimported(item)).blocks).toStrictEqual(content(item).blocks);
  });
});

const tabsLabelled = (label: string): LibraryBlock => ({
  children: [
    { children: [{ children: [{ text: "one" }], type: "p" }], label: "First", type: "tab_panel" },
    { children: [{ children: [{ text: "two" }], type: "p" }], label, type: "tab_panel" },
  ],
  id: "tabs",
  type: "tab_group",
});

describe("a tab's label", () => {
  it.each([
    "Plain words",
    "Draft 2",
    "@2026-08-22",
    "{{1+1}}",
    "**x**",
    "[[Note]]",
    "`x`",
    "<b>",
    "a\\",
    "a ] b",
    ":date[2026-08-22]",
    "https://example.com",
    "me@example.com",
    "",
  ])("writes %j and reads it back as the label it is", (label) => {
    const typed = typedItem("note", [tabsLabelled(label)]);
    expect(content(reimported(typed))).toStrictEqual(content(typed));
    expect(content(reimported(reimported(typed)))).toStrictEqual(content(typed));
  });

  it("reads a hand-written label's words, its marks aside", () => {
    const item = imported("::::tabs\n:::tab[*Draft* `2`]\none\n:::\n::::\n");
    expect(item.blocks[0]?.block).toMatchObject({
      children: [{ label: "Draft 2", type: "tab_panel" }],
    });
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
    expect(types(item)).toStrictEqual(["code_block", "p"]);
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
      expect(new Set(types(item))).toStrictEqual(new Set(["code_block"]));
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
    String.raw`[[Other\|shown]]`,
    String.raw`![[Other\|300]]`,
    "[[Other]]",
    "**[[Other]]**",
  ])("reads %s in a cell as a link to the page, its alias and marks gone", (cell) => {
    const item = imported(`| a | b |\n| - | - |\n| ${cell} | word |\n`);
    expect(item.leftOut).toBe(0);
    expect(stored(item)).toContain('"type":"mention","value":"Other"');
    expect(exported(item).text).toContain("| [Other](mention:");
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
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
    const again = reimported(item);
    expect(content(again)).toStrictEqual(content(item));
    expect(exported(reimported(again)).text).toBe(exported(item).text);
  });

  const IMAGE = "![i](https://a.b/c.png)";

  it.each([
    ["after the image", `${IMAGE} <br/> y`, [" y"], `${IMAGE}<br/> y`],
    ["before the image", `y <br/> ${IMAGE}`, ["y "], `y <br/>${IMAGE}`],
    ["on both sides", `x <br/> ${IMAGE} <br/> y`, ["x ", " y"], `x <br/>${IMAGE}<br/> y`],
    ["between two images", `${IMAGE} ${IMAGE}`, [], `${IMAGE}<br/>${IMAGE}`],
  ])("reads the space %s as the edge the image has", (_name, cell, lines, written) => {
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(
      [...stored(item).matchAll(/"text":"(?<text>[^"]*)"\}\],"type":"p"/gu)].map(
        ([, text]) => text,
      ),
    ).toStrictEqual(["a", ...lines]);
    expect(exported(item).text).toContain(`| ${written} |`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("keeps a blank line a person left between an image and a caption", () => {
    const cell = `${IMAGE}<br/> <br/>y`;
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(exported(item).text).toContain(`| ${cell} |`);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it.each([
    ["one<br/>two", ["one", "two"]],
    ["one<br>two", ["one", "two"]],
    ["**one<br/>two**", ["one", "two"]],
    ["one<br/><br/>two", ["one", "", "two"]],
    ["<br/>one<br/>", ["", "one", ""]],
    ["<br/>", ["", ""]],
  ])("reads the breaks in `%s` as the cell's lines", (cell, lines) => {
    const item = imported(`| a |\n| - |\n| ${cell} |\n`);
    expect(item.leftOut).toBe(0);
    expect(
      [...stored(item).matchAll(/"text":"(?<text>[^"]*)"/gu)].map(([, text]) => text),
    ).toStrictEqual(["a", ...lines]);
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("reads an escaped tag in a cell as the text it spells", () => {
    const item = imported(String.raw`| a |
| - |
| one\<br/>two |
`);
    expect(stored(item)).toContain('"text":"one<br/>two"');
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
    expect(stored(again).match(/"type":"t[dh]"/gu)).toHaveLength(2);
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
    expect(stored(reimported(item))).toContain(String.raw`\\Vert x\\Vert `);
  });

  it("keeps the words of a link and the source of an image that name no address", () => {
    const item = imported(
      "Before [words]() after.\n\n- ![seen]()\n- [listed]()\n\n> [quoted](<>)\n\n| a |\n| - |\n| [cell]() |\n",
    );
    expect(item.leftOut).toBe(0);
    for (const kept of ["Before words after.", "![seen]()", "listed", "quoted", "cell"]) {
      expect(stored(item)).toContain(kept);
    }
    expect(stored(item)).not.toContain('"type":"a"');
    expect(content(reimported(item))).toStrictEqual(content(item));
  });

  it("counts what it left out: a block no item can hold", () => {
    const fence = `\`\`\`inteligir-html\n${"x".repeat(BLOCK_MAX_BYTES)}\n\`\`\`\n`;
    const item = imported(`Kept.\n\n${fence}`);
    expect(item.leftOut).toBe(1);
    expect(stored(item)).toContain("Kept.");
  });
});
