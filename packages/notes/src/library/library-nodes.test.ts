import { describe, expect, it } from "vitest";

import { libraryBlockSchema, libraryNodeSchema, storableBlockSchema } from "./library-nodes";

const leaf = [{ text: "" }];
const sha = "a".repeat(64);

// one of every block the vocabulary holds, as the editor's kits write them
const EVERY_BLOCK = [
  {
    checked: false,
    children: [
      { bold: true, text: "Bold" },
      { italic: true, text: " italic" },
      { children: [{ code: true, text: "link" }], type: "a", url: "https://example.com" },
      { alias: "shown", children: leaf, itemId: "item-2", title: "Other", type: "wikiLink" },
      { children: leaf, itemId: null, title: "Not yet", type: "wikiLink" },
      { blockRef: "b1", children: leaf, itemId: "item-3", type: "wikiEmbed" },
      { children: leaf, type: "tag", value: "work/plans" },
      { children: leaf, date: "2026-07-01", type: "date" },
      {
        children: leaf,
        display: "12,000",
        meta: "id=f1;name=budget",
        source: "1000*12",
        type: "formulaPill",
      },
      { children: leaf, texExpression: "x^2", type: "inline_equation" },
      { children: leaf, source: "<!-- kept -->", type: "opaque" },
      { children: leaf, edge: "start", ids: "a,b", type: "annotationMarker" },
    ],
    id: "p1",
    indent: 1,
    listStyleType: "todo",
    type: "p",
  },
  { children: [{ text: "Title" }], id: "h1", type: "h1" },
  { children: [{ text: "Quote" }], id: "q1", type: "blockquote" },
  {
    children: [{ children: [{ text: "const a = 1;" }], type: "code_line" }],
    id: "c1",
    lang: "ts",
    type: "code_block",
  },
  { children: leaf, id: "hr1", type: "hr" },
  {
    align: ["left", null],
    children: [
      {
        children: [
          { children: [{ children: [{ text: "a" }], type: "p" }], type: "th" },
          { children: [{ children: [{ text: "b" }], type: "p" }], type: "td" },
        ],
        type: "tr",
      },
    ],
    id: "t1",
    type: "table",
  },
  { children: [{ text: "More" }], id: "tg1", type: "toggle" },
  {
    children: [
      { children: [{ children: [{ text: "left" }], type: "p" }], type: "column", width: "50%" },
    ],
    id: "cols",
    type: "column_group",
  },
  {
    children: [
      { children: [{ children: [{ text: "one" }], type: "p" }], label: "One", type: "tab_panel" },
    ],
    id: "tabs",
    type: "tab_group",
  },
  { children: leaf, id: "eq", texExpression: "\\int x", type: "equation" },
  { caption: [{ text: "A cover" }], children: leaf, id: "img1", sha, type: "img", width: 300 },
  { children: leaf, id: "img2", type: "img", url: "https://example.com/a.png" },
  { children: leaf, id: "f1", name: "paper.pdf", sha, type: "file" },
  { children: leaf, id: "v1", type: "video", url: "https://www.youtube.com/watch?v=x" },
  { children: leaf, id: "m1", type: "media_embed", url: "https://twitter.com/a/status/1" },
  { children: leaf, id: "ch", type: "chart_block", value: "{}" },
  { children: leaf, id: "cv", type: "canvas_block", value: "[inteligir:grid:v2]" },
  { children: leaf, id: "ht", type: "html_block", value: "<div></div>" },
];

describe("the persisted node set", () => {
  it.each(EVERY_BLOCK.map((block) => [block.type, block] as const))(
    "holds a %s block",
    (_, block) => {
      expect(libraryBlockSchema.safeParse(block).error?.issues).toBeUndefined();
    },
  );

  it.each([
    ["a prop no node names", { children: [{ text: "a" }], color: "red", id: "p", type: "p" }],
    ["a type no kit has", { children: [{ text: "a" }], id: "p", type: "callout" }],
    ["a top-level block without its id", { children: [{ text: "a" }], type: "p" }],
    ["a nested-only element at the top", { children: [{ text: "a" }], id: "r", type: "tr" }],
    ["an image with both a sha and a url", { children: leaf, id: "i", sha, type: "img", url: "u" }],
    ["an image with neither", { children: leaf, id: "i", type: "img" }],
    ["a mark spelled false", { children: [{ bold: false, text: "a" }], id: "p", type: "p" }],
    ["a void with text inside", { children: [{ text: "x" }], id: "hr", type: "hr" }],
    ["an id with a newline", { children: [{ text: "a" }], id: "a\nb", type: "p" }],
    [
      "a date that is no day",
      { children: [{ children: leaf, date: "2026-02-30", type: "date" }], id: "p", type: "p" },
    ],
    [
      "a tag that is no tag",
      { children: [{ children: leaf, type: "tag", value: "1st" }], id: "p", type: "p" },
    ],
    [
      "the old wiki link spelling",
      { children: [{ body: "Note", children: leaf, type: "wikiLink" }], id: "p", type: "p" },
    ],
  ])("refuses %s", (_, block) => {
    expect(libraryBlockSchema.validate(block)).toBe(false);
  });

  it("reads a text leaf and an inline element as nodes", () => {
    expect(libraryNodeSchema.validate({ text: "plain" })).toBe(true);
    expect(libraryNodeSchema.validate({ children: leaf, date: "2024-02-29", type: "date" })).toBe(
      true,
    );
  });

  it("stores what it parses as written", () => {
    const [first] = EVERY_BLOCK;
    expect(storableBlockSchema.parse(first)).toEqual(first);
  });
});
