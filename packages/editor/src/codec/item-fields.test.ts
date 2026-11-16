import { describe, expect, it } from "vitest";

import { blankItemFields } from "@repo/contract/library/item-makes";
import { ITEM_FIELD_CAPS } from "@repo/contract/library/library-item";

import { factsOf, itemFields, readFrontmatter, titleOf } from "./item-fields";
import type { FileFacts } from "./item-fields";

const NOW = Date.UTC(2026, 10, 16);

const said = (yaml: string): FileFacts => factsOf(readFrontmatter(yaml));
const fieldsOf = (yaml: string | null, name = "Name") =>
  itemFields(factsOf(readFrontmatter(yaml)), name, NOW);
const aliasesOf = (yaml: string): string[] => said(yaml).fields.aliases;
const tagsOf = (yaml: string): string[] => said(yaml).fields.tags;

// each list ten of the one before, so the last names ten thousand
const tenOf = (entry: string): string => `[${Array.from({ length: 10 }, () => entry).join(", ")}]`;
const ALIAS_BOMB = [
  `a: &a ${tenOf("x")}`,
  `b: &b ${tenOf("*a")}`,
  `c: &c ${tenOf("*b")}`,
  `d: &d ${tenOf("*c")}`,
].join("\n");

describe("a file's frontmatter, read once", () => {
  it.each([null, "", "   \n  "])("reads %j as none", (yaml) => {
    expect(readFrontmatter(yaml)).toStrictEqual({ kind: "none" });
  });

  it.each([
    ["malformed", "a: [1, 2\nb: :\n"],
    ["a key named twice", "a: 1\na: 2\n"],
    ["a list at the root", "- a\n- b\n"],
    ["a line of text", "just a string\n"],
    ["a comment alone", "# nothing\n"],
    ["an alias to an anchor never set", "a: *nope\n"],
    ["more aliases than the parser follows", ALIAS_BOMB],
  ])("keeps a block that is no YAML mapping, %s, as written", (_what, yaml) => {
    expect(readFrontmatter(yaml)).toStrictEqual({ kind: "invalid", yaml });
  });

  it("reads a file with no block, or one that is not YAML, as a blank note by its name", () => {
    const blank = { ...blankItemFields(NOW), title: "Name" };
    expect(fieldsOf(null)).toStrictEqual(blank);
    expect(fieldsOf("key: [unclosed\n")).toStrictEqual(blank);
    expect(fieldsOf("status: active\n")).toStrictEqual({
      ...blank,
      properties: { status: "active" },
    });
  });

  it("keeps every key no field names, typed as written", () => {
    const facts = said(
      [
        "published: true",
        "count: 3",
        "due: 2026-07-01",
        "maybe: yes",
        "nested:",
        "  a: 1",
        "people: [Ada, 2]",
        "odd: .nan",
        "empty:",
      ].join("\n"),
    );
    expect(facts.properties).toStrictEqual({
      count: 3,
      due: "2026-07-01",
      empty: null,
      maybe: "yes",
      nested: { a: 1 },
      odd: ".nan",
      people: ["Ada", 2],
      published: true,
    });
  });
});

describe("the keys an item's fields are read from", () => {
  it("folds the kind, and leaves one no item is a property", () => {
    expect(said("kind: ' LINK '\n").fields.kind).toBe("link");
    expect(said("kind: bookmark\n")).toMatchObject({
      fields: { kind: "note" },
      properties: { kind: "bookmark" },
    });
    expect(said("kind: 5\n")).toMatchObject({ fields: { kind: "note" }, properties: { kind: 5 } });
  });

  it("keeps only a web url an item holds, as written, and any kind may carry one", () => {
    expect(said("url: ftp://a.com\n")).toMatchObject({
      fields: { url: null },
      properties: { url: "ftp://a.com" },
    });
    expect(said("url: https://a.com/x?utm_source=y\n")).toMatchObject({
      fields: { kind: "note", url: "https://a.com/x?utm_source=y" },
      properties: {},
    });
    const long = `https://a.com/${"x".repeat(ITEM_FIELD_CAPS.url)}`;
    expect(said(`url: ${long}\n`)).toMatchObject({
      fields: { url: null },
      properties: { url: long },
    });
  });

  it("reads authors as the names they show, and a date or a number as written", () => {
    const facts = said(
      [
        "author:",
        "  - '[[Steph Ango]]'",
        "  - '[[people/kai|Kai]]'",
        "published: 2023",
        "site: Example",
        "description: '  A page.  '",
        "lang: en",
      ].join("\n"),
    );
    expect(facts.fields).toMatchObject({
      author: "Steph Ango, Kai",
      description: "A page.",
      lang: "en",
      published: "2023",
      site: "Example",
    });
    expect(facts.properties).toStrictEqual({});
    expect(said("author: '[[Ada]]'\n").fields.author).toBe("Ada");
    expect(said("author: [Ada, 2]\n")).toMatchObject({
      fields: { author: null },
      properties: { author: ["Ada", 2] },
    });
  });

  it("cuts a line to what a field holds, between characters", () => {
    const { site } = said(`site: a${"😀".repeat(ITEM_FIELD_CAPS.line)}\n`).fields;
    expect(site).toBe(`a${"😀".repeat((ITEM_FIELD_CAPS.line - 2) / 2)}`);
    expect(titleOf(said(""), `  ${"n".repeat(ITEM_FIELD_CAPS.line + 1)}`)).toHaveLength(
      ITEM_FIELD_CAPS.line,
    );
  });

  it("reads the item's own id and instant, and keeps neither as a property", () => {
    expect(said("id: ' abc '\nsaved: 2026-10-17\n")).toMatchObject({
      id: "abc",
      properties: {},
      savedAt: Date.UTC(2026, 9, 17),
    });
    expect(said("id: 42\nsaved: someday\n")).toMatchObject({
      id: null,
      properties: {},
      savedAt: null,
    });
  });

  it("pins by a checkbox alone, as of when the item was saved", () => {
    expect(fieldsOf("pinned: true\nsaved: 2026-10-17\n")).toMatchObject({
      pinnedAt: Date.UTC(2026, 9, 17),
      properties: {},
    });
    expect(fieldsOf("pinned: true\n").pinnedAt).toBe(NOW);
    expect(fieldsOf("pinned: false\n")).toMatchObject({ pinnedAt: null, properties: {} });
    expect(fieldsOf("pinned: yes\n")).toMatchObject({
      pinnedAt: null,
      properties: { pinned: "yes" },
    });
  });

  it("takes a `title:`, an empty one among them, over the file's name", () => {
    expect(fieldsOf("title: Home\n")).toMatchObject({ properties: {}, title: "Home" });
    expect(fieldsOf('title: ""\n')).toMatchObject({ properties: {}, title: "" });
    expect(fieldsOf("title: 5\n")).toMatchObject({ properties: { title: 5 }, title: "Name" });
  });
});

describe("a file's aliases", () => {
  it("reads a list in order, or one bare string", () => {
    expect(aliasesOf("aliases:\n  - Retro\n  - Post-mortem\n")).toStrictEqual([
      "Retro",
      "Post-mortem",
    ]);
    expect(aliasesOf("aliases: Retro\n")).toStrictEqual(["Retro"]);
    expect(aliasesOf("aliases: 2026-07-15\n")).toStrictEqual(["2026-07-15"]);
  });

  it("reads Obsidian's older `alias:` only where no `aliases:` is", () => {
    expect(aliasesOf("alias: Retro\n")).toStrictEqual(["Retro"]);
    expect(said("aliases: [A]\nalias: B\n")).toMatchObject({
      fields: { aliases: ["A"] },
      properties: { alias: "B" },
    });
  });

  it("keeps the first of a spelling, and leaves what is no name a property", () => {
    expect(said("aliases:\n  - ' Padded '\n  - ''\n  - padded\n  - Other\n")).toMatchObject({
      fields: { aliases: ["Padded", "Other"] },
      properties: { aliases: [""] },
    });
    expect(said("aliases: [1, two]\n")).toMatchObject({
      fields: { aliases: ["two"] },
      properties: { aliases: [1] },
    });
    expect(said("aliases: 42\n")).toMatchObject({
      fields: { aliases: [] },
      properties: { aliases: 42 },
    });
    expect(said("aliases: {a: b}\n")).toMatchObject({
      fields: { aliases: [] },
      properties: { aliases: { a: "b" } },
    });
    expect(said("aliases:\n")).toMatchObject({ fields: { aliases: [] }, properties: {} });
  });

  it("takes no more than an item holds, and leaves the rest", () => {
    const names = Array.from(
      { length: ITEM_FIELD_CAPS.listEntries + 1 },
      (_, index) => `a${String(index)}`,
    );
    expect(said(`aliases: [${names.join(", ")}]\n`)).toMatchObject({
      fields: { aliases: names.slice(0, ITEM_FIELD_CAPS.listEntries) },
      properties: { aliases: names.slice(ITEM_FIELD_CAPS.listEntries) },
    });
  });
});

describe("a file's tags", () => {
  it("reads a list in order, or one bare string, a leading `#` left off", () => {
    expect(tagsOf("tags:\n  - meta\n  - demo\n")).toStrictEqual(["meta", "demo"]);
    expect(tagsOf('tags: ["#alpha", beta, Alpha]\n')).toStrictEqual(["alpha", "beta"]);
    expect(tagsOf("tags: single\n")).toStrictEqual(["single"]);
    expect(tagsOf("tags: '#hashed'\n")).toStrictEqual(["hashed"]);
  });

  it("reads only what an inline `#` could spell, and leaves the rest a property", () => {
    expect(said("tags: [2026, reading list, ok]\n")).toMatchObject({
      fields: { tags: ["ok"] },
      properties: { tags: [2026, "reading list"] },
    });
    expect(said('tags: ["2026", ok]\n')).toMatchObject({
      fields: { tags: ["ok"] },
      properties: { tags: ["2026"] },
    });
    expect(said("tags: 2026\n")).toMatchObject({
      fields: { tags: [] },
      properties: { tags: 2026 },
    });
  });
});

describe("where a file's page stands", () => {
  it.each([
    ["kind: link\nurl: https://a.com\n", { at: null, state: "pending" }],
    ["url: https://a.com\n", { state: "none" }],
    ["url: https://a.com\nfetched: 2026-05-01\n", { at: Date.UTC(2026, 4, 1), state: "read" }],
    [
      "url: https://a.com\nfetched: 2026-05-01\nfetch-error: Gone\n",
      { at: Date.UTC(2026, 4, 1), error: "Gone", state: "failed" },
    ],
    ["url: https://a.com\nfetch-error: Gone\n", { at: null, error: "Gone", state: "failed" }],
  ])("reads %j", (yaml, reading) => {
    expect(said(yaml)).toMatchObject({ properties: {}, reading });
  });

  it("keeps what a file with no address says of a reading as properties", () => {
    const yaml = "kind: link\nfetched: 2026-05-01\nfetch-error: Gone\n";
    expect(said(yaml)).toMatchObject({
      properties: { "fetch-error": "Gone", fetched: "2026-05-01" },
      reading: { state: "none" },
    });
    expect(fieldsOf(yaml).reading).toStrictEqual({ state: "none" });
  });

  it("keeps a `fetched:` that is no instant a property", () => {
    expect(said("kind: link\nurl: https://a.com\nfetched: someday\n")).toMatchObject({
      properties: { fetched: "someday" },
      reading: { at: null, state: "pending" },
    });
  });
});
