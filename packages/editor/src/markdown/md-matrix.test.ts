// Every node, mark and prop the library persists, through markdown and back: a value written and
// read again means what it meant, and is a block a store takes, but for the losses each row names.

import { describe, expect, it } from "vitest";
import type { Descendant, TElement, TText } from "platejs";

import { storableBlockSchema } from "@repo/contract/library/library-nodes";

import { schemaPairs, usedPairs } from "../test-support/library-node-pairs";
import { meaningOf, readValue, writeValue } from "../test-support/markdown-meaning";
import { parseMarkdown, parseMarkdownSections } from "./markdown-doc";
import { ARTICLE_SECTION_KEY } from "./md-rules";

type Marks = Partial<Record<"bold" | "code" | "italic" | "strikethrough" | "underline", true>>;
type Props = Omit<TElement, "children" | "type">;

const t = (text: string, marks: Marks = {}): TText => ({ text, ...marks });
const el = (type: string, children: Descendant[], props: Props = {}): TElement => ({
  children,
  type,
  ...props,
});
const p = (...children: Descendant[]): TElement =>
  el("p", children.length > 0 ? children : [t("")]);
const li = (text: string, props: Props): TElement => el("p", [t(text)], props);
const voidEl = (type: string, props: Props): TElement => el(type, [t("")], props);
const code = (lang: string | null, lines: string[]): TElement =>
  el(
    "code_block",
    lines.map((line) => el("code_line", [t(line)])),
    lang === null ? {} : { lang },
  );
const cell = (type: "td" | "th", ...blocks: TElement[]): TElement => el(type, blocks);
const row = (...cells: TElement[]): TElement => el("tr", cells);
const bullet = (indent: number): Props => ({ indent, listStyleType: "disc" });

// a value written and read back; `expected` is what the read answers where it differs, a
// normalization or a loss the row names
interface ValueRow {
  readonly node: string;
  readonly value: TElement[];
  readonly expected?: TElement[];
}

// markdown read, and what it read written and read again
interface MarkdownRow {
  readonly node: string;
  readonly md: string;
  readonly expected: TElement[];
}

const ALERTS = ["NOTE", "TIP", "IMPORTANT", "WARNING", "CAUTION"] as const;
const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"] as const;

const deepList = (depth: number): TElement[] =>
  Array.from({ length: depth }, (_, index) => li(`level ${String(index + 1)}`, bullet(index + 1)));

const VALUE_ROWS: ValueRow[] = [
  { node: "p", value: [p(t("Hello world"))] },
  {
    node: "marks bold, italic, code and strikethrough",
    value: [
      p(
        t("a "),
        t("b", { bold: true }),
        t(" "),
        t("i", { italic: true }),
        t(" "),
        t("c", { code: true }),
        t(" "),
        t("s", { strikethrough: true }),
        t(" "),
        t("bi", { bold: true, italic: true }),
      ),
    ],
  },
  {
    // markdown has no underline, so its words are written plain
    expected: [p(t("a u b"))],
    node: "mark underline",
    value: [p(t("a "), t("u", { underline: true }), t(" b"))],
  },
  ...HEADINGS.map((type): ValueRow => ({ node: type, value: [el(type, [t(`Heading ${type}`)])] })),
  { node: "blockquote", value: [el("blockquote", [p(t("quoted"))])] },
  {
    node: "blockquote of two paragraphs",
    value: [el("blockquote", [p(t("one")), p(t("two"))])],
  },
  ...ALERTS.map((variant): ValueRow => ({
    node: `alert ${variant}`,
    value: [el("blockquote", [p(t(`[!${variant}]\nfirst line\nsecond line`))])],
  })),
  {
    node: "alert with words on its marker's line",
    value: [el("blockquote", [p(t("[!NOTE] Heads up\nbody"))])],
  },
  { node: "toggle", value: [el("toggle", [p(t("Summary")), p(t("body"))])] },
  {
    node: "toggle opening with a heading",
    value: [el("toggle", [el("h3", [t("Section")]), p(t("body"))])],
  },
  {
    node: "toggle in a toggle",
    value: [el("toggle", [p(t("outer")), el("toggle", [p(t("inner")), p(t("deep"))])])],
  },
  { node: "toggle, empty", value: [el("toggle", [p()])] },
  {
    node: "toggle holding a list",
    value: [el("toggle", [p(t("Summary")), li("item", bullet(1))])],
  },
  {
    node: "column_group, its columns' widths",
    value: [
      el("column_group", [
        el("column", [p(t("left"))], { width: "30%" }),
        el("column", [p(t("right")), p(t("more"))], { width: "70%" }),
      ]),
    ],
  },
  {
    node: "column with no width",
    value: [el("column_group", [el("column", [p(t("a"))]), el("column", [p(t("b"))])])],
  },
  {
    // a column has no spelling alone: it writes and reads back as a group of one
    expected: [el("column_group", [el("column", [p(t("alone"))], { width: "50%" })])],
    node: "column outside a group",
    value: [el("column", [p(t("alone"))], { width: "50%" })],
  },
  {
    node: "tab_group, its panels' labels",
    value: [
      el("tab_group", [
        el("tab_panel", [p(t("first"))], { label: "One" }),
        el("tab_panel", [p(t("second"))], { label: "Two words [x] *y*" }),
      ]),
    ],
  },
  {
    node: "tab_panel with an empty label",
    value: [el("tab_group", [el("tab_panel", [p(t("body"))], { label: "" })])],
  },
  { node: "code_block lang", value: [code("ts", ["const a = 1;", "", "  b();"])] },
  { node: "code_block with no lang", value: [code(null, ["plain"])] },
  { node: "code_block mermaid", value: [code("mermaid", ["graph TD", "  A --> B"])] },
  { node: "code_block holding a fence", value: [code("md", ["```js", "x", "```"])] },
  { node: "chart_block", value: [voidEl("chart_block", { value: '{"type":"bar"}' })] },
  { node: "canvas_block", value: [voidEl("canvas_block", { value: "a b\nc d" })] },
  {
    node: "html_block",
    value: [voidEl("html_block", { value: '<div class="x">```</div>\n<!-- c -->' })],
  },
  {
    node: "table, th and td",
    value: [
      el("table", [
        row(cell("th", p(t("Name"))), cell("th", p(t("Value")))),
        row(cell("td", p(t("a"))), cell("td", p(t("1", { bold: true })))),
      ]),
    ],
  },
  {
    node: "table cell of two blocks",
    value: [el("table", [row(cell("th", p(t("h")))), row(cell("td", p(t("x")), p(t("y"))))])],
  },
  {
    node: "table cell, empty",
    value: [
      el("table", [
        row(cell("th", p(t("h"))), cell("th", p(t("i")))),
        row(cell("td", p()), cell("td", p(t("z")))),
      ]),
    ],
  },
  {
    // TeX's own `\|` is written `\Vert` in a row, the same double bar
    expected: [
      el("table", [
        row(cell("th", p(t("h")))),
        row(
          cell(
            "td",
            p(t("v "), voidEl("inline_equation", { texExpression: "|x| + \\Vert y\\Vert " })),
          ),
        ),
      ]),
    ],
    node: "inline_equation in a table row",
    value: [
      el("table", [
        row(cell("th", p(t("h")))),
        row(
          cell(
            "td",
            p(t("v "), voidEl("inline_equation", { texExpression: "|x| + \\|y\\|" }), t("")),
          ),
        ),
      ]),
    ],
  },
  {
    node: "formulaPill in a table cell",
    value: [
      el("table", [
        row(cell("th", p(t("h")))),
        row(
          cell(
            "td",
            p(t(""), voidEl("formulaPill", { display: "a|b", source: "=IF(a|b)" }), t("")),
          ),
        ),
      ]),
    ],
  },
  { node: "hr", value: [p(t("above")), voidEl("hr", {}), p(t("below"))] },
  { node: "equation", value: [voidEl("equation", { texExpression: "E = mc^2" })] },
  { node: "equation of lines", value: [voidEl("equation", { texExpression: "a \\\\\nb" })] },
  {
    node: "img, its url and caption",
    value: [voidEl("img", { caption: [t("A cat")], url: "https://example.com/cat.png" })],
  },
  {
    node: "img title",
    value: [
      voidEl("img", {
        caption: [t("A cat")],
        title: "Cat title",
        url: "https://example.com/cat.png",
      }),
    ],
  },
  {
    // markdown has no image width; the codec writes one into the caption, Obsidian's way
    expected: [voidEl("img", { caption: [t("w")], url: "https://example.com/w.png" })],
    node: "img width",
    value: [voidEl("img", { caption: [t("w")], url: "https://example.com/w.png", width: 320 })],
  },
  {
    // a bare web `![](url)` is an embed
    expected: [voidEl("media_embed", { url: "https://example.com/pic.png" })],
    node: "img on the web with no caption",
    value: [voidEl("img", { url: "https://example.com/pic.png" })],
  },
  { node: "img at a path", value: [voidEl("img", { url: "assets/pic.png" })] },
  { node: "file url", value: [voidEl("file", { url: "https://example.com/doc.pdf" })] },
  {
    // an embed is `![](url)`, so a web file's name has no spelling
    expected: [voidEl("file", { url: "https://example.com/doc.pdf" })],
    node: "file name",
    value: [voidEl("file", { name: "Report.pdf", url: "https://example.com/doc.pdf" })],
  },
  {
    node: "video url",
    value: [voidEl("video", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })],
  },
  {
    node: "media_embed of a post",
    value: [voidEl("media_embed", { url: "https://x.com/jack/status/20" })],
  },
  {
    node: "media_embed of a page",
    value: [voidEl("media_embed", { url: "https://example.com/some/page" })],
  },
  {
    node: "a",
    value: [
      p(
        t("see "),
        el("a", [t("the "), t("site", { bold: true })], { url: "https://example.com/a?b=c" }),
        t("."),
      ),
    ],
  },
  {
    node: "a whose words are its url",
    value: [
      p(
        t("go "),
        el("a", [t("https://example.com/x")], { url: "https://example.com/x" }),
        t(" now"),
      ),
    ],
  },
  {
    node: "mention",
    value: [p(t("see "), voidEl("mention", { key: "0f9c2b1e-item", value: "My page" }), t(" now"))],
  },
  {
    node: "mention whose key and title need escapes",
    value: [p(voidEl("mention", { key: "a b/c(d)", value: "A [b] *c*" }))],
  },
  { node: "mention of an untitled item", value: [p(voidEl("mention", { key: "abc", value: "" }))] },
  { node: "date", value: [p(t("due "), voidEl("date", { date: "2026-01-02" }), t("."))] },
  {
    node: "formulaPill display, source and meta",
    value: [
      p(
        voidEl("formulaPill", {
          display: "42 [ok] *b* _c_ `d` | e",
          meta: "id=f1;name=total",
          source: '=SUM(A1:A3) & "x" & {y}',
        }),
      ),
    ],
  },
  {
    node: "formulaPill with no display",
    value: [p(voidEl("formulaPill", { display: "", source: "=1" }))],
  },
  {
    node: "inline_equation",
    value: [p(t("area "), voidEl("inline_equation", { texExpression: "\\pi r^2" }), t(" done"))],
  },
  {
    // markdown has no empty inline math, so it writes no bytes
    expected: [p(t("a  b"))],
    node: "inline_equation, empty",
    value: [p(t("a "), voidEl("inline_equation", { texExpression: "" }), t(" b"))],
  },
  {
    node: "a line break after an inline node",
    value: [p(voidEl("date", { date: "2026-01-02" }), t("\nnext line"))],
  },
  {
    node: "list of bullets, nested",
    value: [li("a", bullet(1)), li("b", bullet(2)), li("c", bullet(1))],
  },
  {
    node: "list numbered from its start",
    value: [
      li("a", { indent: 1, listStart: 1, listStyleType: "decimal" }),
      li("b", { indent: 1, listStart: 2, listStyleType: "decimal" }),
    ],
  },
  {
    node: "list numbered from 3",
    value: [
      li("a", { indent: 1, listRestartPolite: 3, listStart: 3, listStyleType: "decimal" }),
      li("b", { indent: 1, listStart: 4, listStyleType: "decimal" }),
    ],
  },
  {
    // a restart inside a run is written as one list
    expected: [
      li("a", { indent: 1, listStart: 1, listStyleType: "decimal" }),
      li("b", { indent: 1, listStart: 2, listStyleType: "decimal" }),
    ],
    node: "list restarted",
    value: [
      li("a", { indent: 1, listStart: 1, listStyleType: "decimal" }),
      li("b", { indent: 1, listRestart: 1, listStart: 1, listStyleType: "decimal" }),
    ],
  },
  {
    node: "to-dos, checked and not",
    value: [
      li("done", { checked: true, indent: 1, listStyleType: "todo" }),
      li("open", { checked: false, indent: 1, listStyleType: "todo" }),
    ],
  },
  {
    node: "to-do, empty",
    value: [li("", { checked: false, indent: 1, listStyleType: "todo" })],
  },
  {
    node: "to-dos among bullets",
    value: [
      li("task", { checked: false, indent: 1, listStyleType: "todo" }),
      li("bullet", bullet(1)),
      li("task 2", { checked: true, indent: 1, listStyleType: "todo" }),
    ],
  },
  { node: "list as deep as an item holds", value: deepList(128) },
  ...HEADINGS.map((type): ValueRow => ({
    // only a paragraph is a list item's line: a heading stands outside the list
    expected: [el(type, [t("head")])],
    node: `${type} made a list item`,
    value: [el(type, [t("head")], bullet(1))],
  })),
  {
    node: "blocks nested under a list item",
    value: [
      li("a", bullet(1)),
      el("blockquote", [p(t("q"))], { indent: 2 }),
      el("toggle", [p(t("t"))], { indent: 2 }),
      { ...code("js", ["x"]), indent: 2 },
    ],
  },
  {
    // only a paragraph is a list item's line: a block with no list before it stands alone
    expected: [el("blockquote", [p(t("q"))]), el("toggle", [p(t("t"))]), code("js", ["x"])],
    node: "blocks made list items",
    value: [
      el("blockquote", [p(t("q"))], bullet(1)),
      el("toggle", [p(t("t"))], bullet(1)),
      { ...code("js", ["x"]), ...bullet(1) },
    ],
  },
  {
    node: "every block nested under a list item",
    value: [
      li("a", { indent: 1, listStart: 1, listStyleType: "decimal" }),
      { ...voidEl("hr", {}), indent: 2 },
      { ...voidEl("equation", { texExpression: "x" }), indent: 2 },
      { ...voidEl("img", { caption: [t("c")], url: "https://example.com/i.png" }), indent: 2 },
      { ...voidEl("file", { url: "https://example.com/f.pdf" }), indent: 2 },
      { ...voidEl("video", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" }), indent: 2 },
      { ...voidEl("media_embed", { url: "https://example.com/page" }), indent: 2 },
      { ...voidEl("chart_block", { value: "{}" }), indent: 2 },
      { ...voidEl("canvas_block", { value: "." }), indent: 2 },
      { ...voidEl("html_block", { value: "<b>x</b>" }), indent: 2 },
      el("column_group", [el("column", [p(t("c1"))]), el("column", [p(t("c2"))])], { indent: 2 }),
      el("tab_group", [el("tab_panel", [p(t("tp"))], { label: "L" })], { indent: 2 }),
      el("h2", [t("nested heading")], { indent: 2 }),
      el("table", [row(cell("th", p(t("h")))), row(cell("td", p(t("d"))))], { indent: 2 }),
      el("p", [t("continuation paragraph")], { indent: 2 }),
      li("b", { indent: 1, listStart: 2, listStyleType: "decimal" }),
      li("b.1", bullet(2)),
      { ...code("sh", ["npm i"]), indent: 3 },
    ],
  },
];

const MARKDOWN_ROWS: MarkdownRow[] = [
  {
    expected: [el("toggle", [p(t("Summary "), t("here", { italic: true })), p(t("body"))])],
    md: ":::toggle[Summary *here*]\nbody\n:::",
    node: "toggle with a label",
  },
  {
    expected: [el("column_group", [el("column", [p(t("x"))], { width: "40%" })])],
    md: ':::column{width="40%"}\nx\n:::',
    node: "column outside a group",
  },
  {
    expected: [el("column_group", [el("column", [p(t("stray"))]), el("column", [p(t("x"))])])],
    md: "::::columns\nstray\n:::column\nx\n:::\n::::",
    node: "columns holding a stray paragraph",
  },
  {
    expected: [el("column_group", [el("column", [p(t("x"))])])],
    md: '::::columns\n:::column{width="12px"}\nx\n:::\n::::',
    node: "column whose width is no share",
  },
  {
    // table alignment is dropped
    expected: [el("table", [row(cell("th", p(t("h")))), row(cell("td", p(t("x"))))])],
    md: "| h |\n| :-: |\n| x |",
    node: "table aligned",
  },
  {
    // a link's title is dropped
    expected: [p(el("a", [t("t")], { url: "https://example.com" }))],
    md: '[t](https://example.com "Title")',
    node: "a with a title",
  },
  {
    expected: [voidEl("equation", { texExpression: "E = mc^2" })],
    md: "$$ E = mc^2\n$$",
    node: "equation led on its fence line",
  },
  {
    expected: [p(t("Text[^1] here.")), p(t("[^1]: The note "), t("x", { italic: true }), t("."))],
    md: "Text[^1] here.\n\n[^1]: The note *x*.",
    node: "footnote",
  },
  {
    expected: [code("yaml", ["title: x", "tags: [a]"]), p(t("body"))],
    md: "---\ntitle: x\ntags: [a]\n---\n\nbody",
    node: "a `---` fence opening a paste",
  },
  {
    expected: [voidEl("img", { caption: [t("A cat")], url: "https://example.com/cat.png" })],
    md: "![A cat](https://example.com/cat.png)",
    node: "image alone on its line",
  },
  {
    // a picture is a block, so it splits the line it stands in
    expected: [
      p(t("see ")),
      voidEl("img", { caption: [t("a")], url: "https://example.com/a.png" }),
      p(t(" here")),
    ],
    md: "see ![a](https://example.com/a.png) here",
    node: "image inside a line",
  },
  {
    expected: [voidEl("video", { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ" })],
    md: "![](https://www.youtube.com/watch?v=dQw4w9WgXcQ)",
    node: "video embed",
  },
  {
    expected: [li("", bullet(1)), { ...code("js", ["code()"]), indent: 2 }, li("next", bullet(1))],
    md: "- ```js\n  code()\n  ```\n- next",
    node: "list item opened by a fence",
  },
  {
    // raw html is the text it spells
    expected: [el("p", [t("<div>x</div>")], bullet(1)), li("next", bullet(1))],
    md: "- <div>x</div>\n- next",
    node: "list item opened by html",
  },
  {
    expected: [
      li("", bullet(1)),
      el(
        "table",
        [
          row(cell("th", p(t("a"))), cell("th", p(t("b")))),
          row(cell("td", p(t("1"))), cell("td", p(t("2")))),
        ],
        { indent: 2 },
      ),
      li("next", bullet(1)),
    ],
    md: "- | a | b |\n  | - | - |\n  | 1 | 2 |\n- next",
    node: "list item opened by a table",
  },
  {
    // a list item's line is a paragraph
    expected: [li("Title", bullet(1)), li("next", bullet(1))],
    md: "- # Title\n- next",
    node: "list item opened by a heading",
  },
  {
    expected: [
      li("", { checked: false, indent: 1, listStyleType: "todo" }),
      li("", { checked: true, indent: 1, listStyleType: "todo" }),
    ],
    md: "- [ ]\n- [x]",
    node: "to-dos, empty",
  },
  {
    expected: [
      li("a", { indent: 1, listRestartPolite: 3, listStart: 3, listStyleType: "decimal" }),
      li("b", { indent: 1, listStart: 4, listStyleType: "decimal" }),
    ],
    md: "3. a\n4. b",
    node: "list numbered from 3",
  },
  {
    expected: [
      li("a", { checked: false, indent: 1, listStyleType: "todo" }),
      li("b", bullet(1)),
      li("c", { checked: true, indent: 1, listStyleType: "todo" }),
    ],
    md: "- [ ] a\n- b\n- [x] c",
    node: "to-dos among bullets",
  },
  {
    expected: Array.from({ length: 128 }, (_, index) => li("x", bullet(index + 1))),
    md: Array.from({ length: 128 }, (_, index) => `${"  ".repeat(index)}- x`).join("\n"),
    node: "list as deep as an item holds",
  },
  {
    expected: [
      el("table", [row(cell("th", p(t("a")))), row(cell("td", p(t("x")), p(t("y")), p(t("z"))))]),
    ],
    md: "| a |\n| - |\n| x<br/>y<br>z |",
    node: "table cell cut at its breaks",
  },
  {
    expected: [
      el("table", [
        row(cell("th", p(t("a")))),
        row(cell("td", p(voidEl("inline_equation", { texExpression: "x|y" })))),
      ]),
    ],
    md: "| a |\n| - |\n| $$x\\|y$$ |",
    node: "inline math holding a pipe in a row",
  },
  {
    expected: [el("blockquote", [p(t("[!TIP]\none\ntwo"))])],
    md: "> [!TIP]\n> one\\\n> two",
    node: "alert holding a hard break",
  },
  {
    expected: [p(t(":::unknown")), p(t("body")), p(t(":::"))],
    md: ":::unknown\nbody\n:::",
    node: "container no block is",
  },
];

// a value's blocks as a store takes them, each named as a top-level block is
const unstorable = (value: readonly TElement[]): string[] =>
  value.flatMap((block, index) => {
    const parsed = storableBlockSchema.safeParse({ ...block, id: `b${String(index)}` });
    return parsed.success
      ? []
      : [`${block.type}: ${parsed.error.issues.map((issue) => issue.message).join("; ")}`];
  });

describe("a value written and read back", () => {
  it.each(VALUE_ROWS)("keeps $node", ({ expected, value }) => {
    const written = writeValue(value);
    const read = readValue(written);
    expect(meaningOf(read)).toBe(meaningOf(expected ?? value));
    expect(unstorable(read)).toStrictEqual([]);
    expect(writeValue(read)).toBe(written);
  });
});

describe("markdown read, then written and read again", () => {
  it.each(MARKDOWN_ROWS)("reads $node", ({ expected, md }) => {
    const read = readValue(md);
    expect(meaningOf(read)).toBe(meaningOf(expected));
    expect(unstorable(read)).toStrictEqual([]);
    expect(meaningOf(readValue(writeValue(read)))).toBe(meaningOf(expected));
  });

  it("refuses a list one level deeper than an item holds", () => {
    const md = Array.from({ length: 129 }, (_, index) => `${"  ".repeat(index)}- x`).join("\n");
    expect(parseMarkdown(md)).toStrictEqual({ ok: false, reason: { kind: "too-deep" } });
  });
});

describe("an item's page", () => {
  it("writes its section around containers of its own and reads back as the page", () => {
    const page = [
      p(t("read page")),
      el("toggle", [p(t("Summary")), el("toggle", [p(t("nested"))])]),
      el("tab_group", [el("tab_panel", [p(t("x"))], { label: "T" })]),
    ];
    const read = parseMarkdownSections(
      writeValue([p(t("my note")), el(ARTICLE_SECTION_KEY, page)]),
    );
    if (!read.ok) {
      throw new Error(read.reason.kind);
    }
    expect(meaningOf(read.sections.note)).toBe(meaningOf([p(t("my note"))]));
    expect(meaningOf(read.sections.article ?? [])).toBe(meaningOf(page));
  });
});

// the props a row cannot hold, each with why
const LIST_LINE_ONLY =
  "only a paragraph is a list item's line: another block keeps its indent, never a box or a number";
const NOT_IN_MATRIX = new Map([
  ...["h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "toggle", "code_block"].flatMap((type) =>
    ["checked", "listRestart", "listRestartPolite", "listStart"].map((prop): [string, string] => [
      `${type}.${prop}`,
      LIST_LINE_ONLY,
    ]),
  ),
  ["img.sha", "the codec writes a kept file's sha as its path, and reads the path back"],
  ["file.sha", "the codec writes a kept file's sha as its path, and reads the path back"],
  ["video.sha", "the codec writes a kept file's sha as its path, and reads the path back"],
]);

describe("the matrix", () => {
  it("holds every node, mark and prop the library persists, or says why not", () => {
    const used = new Set<string>();
    for (const { value } of VALUE_ROWS) {
      usedPairs(value, used);
    }
    for (const { expected } of MARKDOWN_ROWS) {
      usedPairs(expected, used);
    }
    expect(
      schemaPairs().filter((pair) => !used.has(pair) && !NOT_IN_MATRIX.has(pair)),
    ).toStrictEqual([]);
  });

  it("excuses only pairs the node set names", () => {
    const pairs = new Set(schemaPairs());
    expect([...NOT_IN_MATRIX.keys()].filter((pair) => !pairs.has(pair))).toStrictEqual([]);
  });
});
