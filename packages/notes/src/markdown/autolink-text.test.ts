import type { Nodes } from "mdast";
import type { Handle, Options } from "mdast-util-to-markdown";
import { defaultHandlers, toMarkdown } from "mdast-util-to-markdown";
import { describe, expect, it } from "vitest";

import { besideChild, isBareLink } from "./autolink-text";
import { MD_PROCESSOR, MD_STRINGIFY } from "./md-plugins";

const link = (text: string, url = text) => ({
  children: [{ type: "text", value: text }],
  url,
});

const NOTHING = { after: "", before: "" };

describe(isBareLink, () => {
  it.each([
    ["a url", link("https://x.y/a")],
    ["a url with balanced parens", link("https://x.y/Mercury_(planet)")],
    ["a www address", link("www.x.y/a", "http://www.x.y/a")],
    ["a mail address", link("a@b.cd", "mailto:a@b.cd")],
  ])("is true of %s", (_name, node) => {
    expect(isBareLink(node, NOTHING)).toBe(true);
  });

  it.each([
    ["words of its own", link("see this", "https://x.y/a")],
    ["an address that ends on what a literal leaves off", link("https://x.y/a!")],
    ["a www address that does", link("www.x.y/a.", "http://www.x.y/a.")],
    ["an underscore in the domain", link("https://foo_bar.example_x/a")],
    ["no domain", link("https://")],
    ["a mail address with no dot", link("a@b", "mailto:a@b")],
    ["a scheme gfm has no literal for", link("tel:123")],
    ["a title", { ...link("https://x.y/a"), title: "words" }],
    [
      "a label of several nodes",
      { children: [{ type: "strong" }, { type: "text", value: "b" }], url: "https://x.y/a" },
    ],
  ])("is false of %s", (_name, node) => {
    expect(isBareLink(node, NOTHING)).toBe(false);
  });

  it.each([
    ["a word after it", { after: "b", before: "" }, false],
    ["an apostrophe that runs on", { after: "'s page", before: "" }, false],
    ["punctuation and a word", { after: ",b", before: "" }, false],
    ["a word before it", { after: "", before: "x" }, false],
    ["a space after it", { after: " b", before: "" }, true],
    ["punctuation a literal leaves off", { after: ". b", before: "" }, true],
    ["a tag", { after: "<u>b</u>", before: "" }, true],
    ["a paren around it", { after: ")", before: "(" }, true],
    ["a `<` the writer escapes", { after: ">", before: "<" }, false],
    ["a `[` the writer escapes", { after: "]", before: "[" }, true],
    ["a `>` that opens no quote", { after: "", before: ">" }, true],
  ])("hears what stands beside it: %s", (_name, beside, bare) => {
    expect(isBareLink(link("https://x.y/a"), beside)).toBe(bare);
  });

  it("is false of a mail address a `>` follows, which an angle further back would close on", () => {
    expect(isBareLink(link("a@b.cd", "mailto:a@b.cd"), { after: ">", before: "#" })).toBe(false);
  });

  it.each([["."], ["-"], ["+"], ["_"]])("is false of a mail address `%s` runs into", (before) => {
    const address = link("www.x.y@b.cd", "http://www.x.y@b.cd");
    expect(isBareLink(address, { after: "", before })).toBe(false);
  });
});

describe(besideChild, () => {
  const url: Nodes = { children: [], type: "link", url: "https://x.y/a" };

  it("reads a text's words", () => {
    expect(
      besideChild([{ type: "text", value: "one two" }, url, { type: "text", value: "'s page" }], 1),
    ).toStrictEqual({ after: "'s page", before: "o" });
  });

  it("reads a line break as a line's end", () => {
    expect(besideChild([{ type: "break" }, url, { type: "break" }], 1)).toStrictEqual({
      after: "\n",
      before: "\n",
    });
  });

  it("stands a word after a literal for syntax, and punctuation before one", () => {
    const code: Nodes = { type: "inlineCode", value: "c" };
    expect(isBareLink(link("https://x.y/a"), besideChild([url, code], 0))).toBe(false);
    expect(isBareLink(link("https://x.y/a"), besideChild([code, url], 1))).toBe(true);
  });

  it("is nothing at a block's edges", () => {
    expect(besideChild([url], 0)).toStrictEqual({ after: "", before: "" });
  });
});

describe("the look past a link", () => {
  const nested = (depth: number): string =>
    Array.from({ length: depth }).reduce<string>(
      (inner) => `<b>w [https://x.y/a](https://x.y/a) ${inner}</b>`,
      "`c`",
    );

  it("writes what a tag holds a few times a level, however deep the tags go", () => {
    const depth = 10;
    let writes = 0;
    const inlineCode: Handle = (node, parent, state) => {
      writes += 1;
      return defaultHandlers.inlineCode(node, parent, state);
    };
    const options: Options = {
      ...MD_STRINGIFY,
      extensions: MD_PROCESSOR.data("toMarkdownExtensions"),
      handlers: { ...MD_STRINGIFY.handlers, inlineCode },
    };
    const written = toMarkdown(MD_PROCESSOR.parse(`${nested(depth)}\n`), options);
    expect(written).toBe(
      `${nested(depth).replaceAll("[https://x.y/a](https://x.y/a)", "https://x.y/a")}\n`,
    );
    expect(writes).toBeLessThan(depth * 5);
  });
});
