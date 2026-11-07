import { describe, expect, it } from "vitest";

import { deriveItem } from "./derive-item";
import type { LibraryBlock } from "./library-nodes";
import { itemOf, noteFields, paragraph } from "../test-support/library-items";

const leaf: [{ text: "" }] = [{ text: "" }];

const linked: LibraryBlock = {
  children: [
    { text: "See " },
    { children: leaf, itemId: "item-2", title: "Other", type: "wikiLink" },
    { text: " and " },
    { children: leaf, itemId: null, title: "Not Yet", type: "wikiLink", heading: "Part" },
    { text: ", " },
    { children: [{ text: "the site" }], type: "a", url: "https://www.example.com/a?utm_source=x" },
    { text: " #Work/plans " },
    { children: leaf, edge: "start", ids: "h1,h2", type: "annotationMarker" },
    { text: "marked" },
    { children: leaf, edge: "end", ids: "h1,h2", type: "annotationMarker" },
  ],
  id: "p2",
  type: "p",
};

describe(deriveItem, () => {
  it("reads links by id and url key, and a link to no item yet is none", () => {
    const derived = deriveItem(noteFields(), itemOf([linked]).blocks);
    expect(derived.links).toStrictEqual([
      { targetId: "item-2", targetKey: null },
      { targetId: null, targetKey: "example.com/a" },
    ]);
  });

  it("reads a link to a place in its own item as its heading's words and no link between items", () => {
    const own: LibraryBlock = {
      children: [
        { text: "See " },
        { children: leaf, heading: "Rollback", itemId: null, title: "", type: "wikiLink" },
      ],
      id: "p3",
      type: "p",
    };
    const derived = deriveItem(noteFields(), itemOf([own]).blocks);
    expect(derived.links).toStrictEqual([]);
    expect(derived.card.preview).toBe("See Rollback");
  });

  it("reads a link to an untitled item by its id alone", () => {
    const untitled: LibraryBlock = {
      children: [{ children: leaf, itemId: "item-2", title: "", type: "wikiLink" }],
      id: "p4",
      type: "p",
    };
    expect(deriveItem(noteFields(), itemOf([untitled]).blocks).links).toMatchObject([
      { targetId: "item-2", targetKey: null },
    ]);
  });

  it("joins the field's tags and the body's chips, each origin once, case folded", () => {
    const derived = deriveItem(
      noteFields({ tags: ["work/plans", "Read"] }),
      itemOf([linked, { ...linked, id: "p3" }]).blocks,
    );
    expect(derived.tags).toStrictEqual([
      { origin: "field", tag: "work/plans" },
      { origin: "field", tag: "Read" },
      { origin: "inline", tag: "Work/plans" },
    ]);
  });

  it("reads a tag from the note's text alone, as the editor draws its chips", () => {
    const literal: LibraryBlock = {
      children: [
        { code: true, text: "#inCode " },
        { children: [{ text: "#inLink" }], type: "a", url: "https://example.com" },
        { text: " #kept and C#notATag" },
      ],
      id: "p4",
      type: "p",
    };
    const fenced: LibraryBlock = {
      children: [{ children: [{ text: "#inFence" }], type: "code_line" }],
      id: "c1",
      type: "code_block",
    };
    const page = itemOf([literal, fenced]);
    const article = new Map(
      [...page.blocks].map(([id, stored]) => [id, { ...stored, section: "article" as const }]),
    );
    expect(deriveItem(noteFields(), page.blocks).tags).toStrictEqual([
      { origin: "inline", tag: "kept" },
    ]);
    expect(deriveItem(noteFields(), article).tags).toStrictEqual([]);
  });

  it("reads an embed by its item's id", () => {
    const embed: LibraryBlock = {
      children: [{ children: leaf, itemId: "item-3", title: "Later", type: "wikiEmbed" }],
      id: "e1",
      type: "p",
    };
    expect(deriveItem(noteFields(), itemOf([embed]).blocks).links).toStrictEqual([
      { targetId: "item-3", targetKey: null },
    ]);
  });

  it("gives each block its text and the highlights it anchors", () => {
    const derived = deriveItem(noteFields(), itemOf([linked]).blocks);
    expect(derived.blocks.get("p2")).toStrictEqual({
      annotationIds: ["h1", "h2"],
      text: "See Other and Not Yet, the site #Work/plans marked",
    });
  });

  it("names an untitled item by its first heading, else its first line", () => {
    const heading: LibraryBlock = { children: [{ text: "Plans\nfor May" }], id: "h", type: "h2" };
    expect(
      deriveItem(noteFields({ title: "  " }), itemOf([paragraph("p", "body"), heading]).blocks).card
        .title,
    ).toBe("Plans");
    expect(
      deriveItem(noteFields({ title: "" }), itemOf([paragraph("p", "  first\nsecond")]).blocks).card
        .title,
    ).toBe("first");
    expect(deriveItem(noteFields({ title: "Named" }), itemOf([heading]).blocks).card.title).toBe(
      "Named",
    );
  });

  it("cards an item: its first paragraph, its outline and its words", () => {
    const { blocks } = itemOf([
      { children: [{ text: "Intro" }], id: "h", type: "h1" },
      { children: [{ text: "a list item" }], id: "l", listStyleType: "disc", type: "p" },
      paragraph("p", "The first paragraph."),
    ]);
    expect(deriveItem(noteFields(), blocks).card).toStrictEqual({
      outline: [{ blockId: "h", level: 1, text: "Intro" }],
      preview: "The first paragraph.",
      title: "A note",
      words: 7,
    });
  });

  it("outlines h1 to h3 as the table of contents does, and ranks every heading", () => {
    const { blocks } = itemOf([
      { children: [{ text: "Four" }], id: "h4", type: "h4" },
      { children: [{ text: "Two" }], id: "h2", type: "h2" },
      { children: [{ text: "Six" }], id: "h6", type: "h6" },
    ]);
    const derived = deriveItem(noteFields({ aliases: ["Alt"], title: "" }), blocks);
    expect(derived.card.outline).toStrictEqual([{ blockId: "h2", level: 2, text: "Two" }]);
    expect(derived.search.headings).toBe("Four\nTwo\nSix\nAlt");
    expect(derived.card.title).toBe("Four");
  });

  it("keeps a card's outline short however many and long its headings run", () => {
    const long = "w".repeat(450_000);
    const headings: LibraryBlock[] = [
      ...Array.from({ length: 5 }, (_, index): LibraryBlock => ({
        children: [{ text: long }],
        id: `long${String(index)}`,
        type: "h1",
      })),
      ...Array.from({ length: 300 }, (_, index): LibraryBlock => ({
        children: [{ text: `Part ${String(index)}` }],
        id: `part${String(index)}`,
        type: "h2",
      })),
    ];
    const { outline } = deriveItem(noteFields(), itemOf(headings).blocks).card;
    expect(outline.length).toBeLessThan(headings.length);
    expect(outline.map((entry) => entry.blockId)).toStrictEqual(
      headings.slice(0, outline.length).map((block) => block.id),
    );
    expect(Math.max(...outline.map((entry) => entry.text.length))).toBeLessThanOrEqual(100);
    expect(outline[0]?.text).toBe(`${"w".repeat(99)}…`);
  });

  it("reads a table row by cell and a code block by line, and reads nothing from a rich block", () => {
    const { blocks } = itemOf([
      {
        children: [
          {
            children: [
              { children: [{ children: [{ text: "a" }], type: "p" }], type: "td" },
              { children: [{ children: [{ text: "b" }], type: "p" }], type: "td" },
            ],
            type: "tr",
          },
        ],
        id: "t",
        type: "table",
      },
      {
        children: [
          { children: [{ text: "one()" }], type: "code_line" },
          { children: [{ text: "two()" }], type: "code_line" },
        ],
        id: "c",
        type: "code_block",
      },
      { children: leaf, id: "x", type: "html_block", value: "<b>hidden</b>" },
    ]);
    expect(deriveItem(noteFields(), blocks).search.body).toBe("a\tb\none()\ntwo()\n");
  });

  it("ranks a url item's address, site and tags as its meta", () => {
    const derived = deriveItem(
      noteFields({
        kind: "link",
        site: "Example",
        tags: ["read"],
        url: "https://example.com/post",
      }),
      new Map(),
    );
    expect(derived.search.meta).toBe("example.com post\nExample\nread");
    expect(derived.urlKey).toBe("example.com/post");
  });
});
