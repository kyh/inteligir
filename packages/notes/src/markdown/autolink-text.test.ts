import type { Nodes } from "mdast";
import { describe, expect, it } from "vitest";

import { besideChild, isBareLink } from "./autolink-text";

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
