import { describe, expect, it } from "vitest";

import { deriveBody, deriveItem } from "./derive-item";
import type { BodyBlock } from "./derive-item";
import type { LibraryItemFields } from "./library-item";
import type { LibraryBlock, LibrarySection } from "./library-nodes";
import { noteFixture, paragraph } from "../test-support/library-items";

const bodyOf = (blocks: readonly LibraryBlock[], section: LibrarySection = "note"): BodyBlock[] =>
  blocks.map((block) => ({ block, section }));

// the item's rows as the cell derives them: its body read once, then the fields over its digest
const derive = (fields: LibraryItemFields, body: readonly BodyBlock[]) => {
  const derived = deriveBody(body);
  return { ...deriveItem(fields, derived.digest), body: derived };
};

const leaf: [{ text: "" }] = [{ text: "" }];

const linked: LibraryBlock = {
  children: [
    { text: "See " },
    { children: leaf, key: "item-2", type: "mention", value: "Other" },
    { text: " and [[Not Yet]], " },
    { children: [{ text: "the site" }], type: "a", url: "https://www.example.com/a?utm_source=x" },
    { text: " #Work/plans marked" },
  ],
  id: "p2",
  type: "p",
};

describe(deriveBody, () => {
  it("reads a page link by its item's id and a url by its key, and a `[[…]]` the text it is", () => {
    const derived = derive(noteFixture(), bodyOf([linked]));
    expect(derived.body.links).toStrictEqual([
      { targetId: "item-2", targetKey: null },
      { targetId: null, targetKey: "example.com/a" },
    ]);
  });

  it("reads a page link as its title's words", () => {
    const mentioned: LibraryBlock = {
      children: [
        { text: "See " },
        { children: leaf, key: "item-2", type: "mention", value: "Other" },
        { text: " now." },
      ],
      id: "p5",
      type: "p",
    };
    const derived = derive(noteFixture(), bodyOf([mentioned]));
    expect(derived.card.preview).toBe("See Other now.");
    expect(derived.body.text).toBe("See Other now.");
  });

  it("reads a link to an untitled item by its id alone", () => {
    const untitled: LibraryBlock = {
      children: [{ children: leaf, key: "item-2", type: "mention", value: "" }],
      id: "p4",
      type: "p",
    };
    expect(derive(noteFixture(), bodyOf([untitled])).body.links).toMatchObject([
      { targetId: "item-2", targetKey: null },
    ]);
  });

  it("reads no word in the line markdown writes an empty paragraph as", () => {
    const derived = derive(
      noteFixture({ title: "" }),
      bodyOf([
        { children: [{ text: "​" }], id: "e", type: "p" },
        { children: [{ text: "Words​ here" }], id: "w", type: "p" },
      ]),
    );
    expect(derived.card.preview).toBe("Words here");
    expect(derived.card.title).toBe("Words here");
    expect(derived.body.text).toBe("\nWords here");
  });

  it("joins the field's tags and the body's chips, each origin once, case folded", () => {
    const derived = derive(
      noteFixture({ tags: ["work/plans", "Read"] }),
      bodyOf([linked, { ...linked, id: "p3" }]),
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
    expect(derive(noteFixture(), bodyOf([literal, fenced])).tags).toStrictEqual([
      { origin: "inline", tag: "kept" },
    ]);
    expect(derive(noteFixture(), bodyOf([literal, fenced], "article")).tags).toStrictEqual([]);
  });

  it("reads a body's text, its files and whether it holds a page", () => {
    const image: LibraryBlock = { children: leaf, id: "i", sha: "a".repeat(64), type: "img" };
    const derived = derive(noteFixture(), [
      ...bodyOf([linked]),
      ...bodyOf([image, paragraph("a", "Read.")], "article"),
    ]);
    expect(derived.body.text).toBe(
      "See Other and [[Not Yet]], the site #Work/plans marked\n\nRead.",
    );
    expect(derived.body.digest).toMatchObject({ article: true, files: ["a".repeat(64)] });
    expect(derive(noteFixture(), bodyOf([linked])).body.digest.article).toBe(false);
  });

  it("names an untitled item by its first heading, else its first line", () => {
    const heading: LibraryBlock = { children: [{ text: "Plans\nfor May" }], id: "h", type: "h2" };
    expect(
      derive(noteFixture({ title: "  " }), bodyOf([paragraph("p", "body"), heading])).card.title,
    ).toBe("Plans");
    expect(
      derive(noteFixture({ title: "" }), bodyOf([paragraph("p", "  first\nsecond")])).card.title,
    ).toBe("first");
    expect(derive(noteFixture({ title: "Named" }), bodyOf([heading])).card.title).toBe("Named");
  });

  it("cards an item: its first paragraph, its outline and its words", () => {
    const blocks = bodyOf([
      { children: [{ text: "Intro" }], id: "h", type: "h1" },
      { children: [{ text: "a list item" }], id: "l", listStyleType: "disc", type: "p" },
      paragraph("p", "The first paragraph."),
    ]);
    expect(derive(noteFixture(), blocks).card).toStrictEqual({
      outline: [{ blockId: "h", level: 1, text: "Intro" }],
      preview: "The first paragraph.",
      title: "A note",
      words: 7,
    });
  });

  it("outlines h1 to h3 as the table of contents does, and ranks every heading", () => {
    const blocks = bodyOf([
      { children: [{ text: "Four" }], id: "h4", type: "h4" },
      { children: [{ text: "Two" }], id: "h2", type: "h2" },
      { children: [{ text: "Six" }], id: "h6", type: "h6" },
    ]);
    const derived = derive(noteFixture({ aliases: ["Alt"], title: "" }), blocks);
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
    const { outline } = derive(noteFixture(), bodyOf(headings)).card;
    expect(outline.length).toBeLessThan(headings.length);
    expect(outline.map((entry) => entry.blockId)).toStrictEqual(
      headings.slice(0, outline.length).map((block) => block.id),
    );
    expect(Math.max(...outline.map((entry) => entry.text.length))).toBeLessThanOrEqual(100);
    expect(outline[0]?.text).toBe(`${"w".repeat(99)}…`);
  });

  it("reads a table row by cell and a code block by line, and reads nothing from a rich block", () => {
    const blocks = bodyOf([
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
    expect(derive(noteFixture(), blocks).body.text).toBe("a\tb\none()\ntwo()\n");
  });

  it("ranks a url item's address, site and tags as its meta", () => {
    const derived = derive(
      noteFixture({
        kind: "link",
        site: "Example",
        tags: ["read"],
        url: "https://example.com/post",
      }),
      [],
    );
    expect(derived.search.meta).toBe("example.com post\nExample\nread");
    expect(derived.urlKey).toBe("example.com/post");
  });
});
