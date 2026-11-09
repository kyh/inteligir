import { describe, expect, it } from "vitest";
import { NodeApi } from "platejs";
import type { TElement } from "platejs";

import { meaningOf, readValue, rewrite, writeValue } from "../test-support/markdown-meaning";

const paragraph = (text: string): TElement[] => [{ children: [{ text }], type: "p" }];

// text a person types that a read could take for markdown, the dialect's or another tool's
const TYPED = [
  ":date[x]",
  ":date[2026-01-02]",
  "due:date[2026-01-02]",
  ':formula[1]{source="=1"}',
  ':formula{source="=1"}',
  "x :date{a=b} y",
  "a:b",
  "10:30",
  "mailto:x@y.z",
  "%%c%%",
  "==hl==",
  "{{x}}",
  "#tag",
  "@word",
  "@2026-01-02",
  "^block-ref",
  "[[Title]]",
  ":::unknown",
  ":::toggle",
  "::::columns",
  ":unknown[x]",
  "::leaf",
  ":smile:",
  "[Title](mention:abc)",
  "$$x$$",
  "$5 and $6",
  "- [ ] not a task",
  "> [!NOTE] typed",
  "<b>x</b>",
  "1. not a list",
  "| a | b |",
  "*star* _under_",
  "back\\slash",
  "[^1] and [^1]: x",
  "&amp; &#x7C;",
];

// GFM reads a bare url in finished text as a link, whatever the writer escapes around it
const TYPED_URLS = ["https://x.y", "see https://x.y/a:b now", "![x](https://y.z/a.png)"];

// markdown a person pastes that only looks like the dialect
const PASTED = [
  "see [[Title]] and [[Other|alias]]",
  ":unknown[x]{a=b}",
  ":date[not a date]",
  ":date[2026-01-02]{x=1}",
  ":formula[no source]",
  "::leaf[x]{y=z}",
  ":smile: :+1:",
  "10:30 a:b",
  "@word @2026-01-02 #tag {{x}} %%c%% ==hl== ^ref",
];

describe("text a person types", () => {
  it.each(TYPED)("keeps %j the text it is through a write and a read", (text) => {
    const written = writeValue(paragraph(text));
    expect(meaningOf(readValue(written))).toBe(meaningOf(paragraph(text)));
    expect(rewrite(written)).toBe(written);
  });

  it.each(TYPED_URLS)("keeps the words of %j, its url read back as a link", (text) => {
    const back = readValue(writeValue(paragraph(text)));
    expect(back.map((block) => NodeApi.string(block)).join("")).toBe(text);
    expect(JSON.stringify(back)).toContain('"type":"a"');
  });

  // a line opening with `::` would open a leaf or a container, which the stock escape keeps text,
  // and gfm escapes the `:` of a url, which its own read takes for a link all the same
  it("escapes a `:` inside a line only before a construct the dialect reads", () => {
    for (const text of TYPED.filter((typed) => !typed.startsWith("::"))) {
      expect(writeValue(paragraph(text)), text).not.toMatch(/\\:(?!(?:date|formula)\\?[[{])/u);
    }
  });
});

describe("markdown a person pastes", () => {
  it.each(PASTED)("reads %j as the text it is", (md) => {
    expect(meaningOf(readValue(md))).toBe(meaningOf(paragraph(md)));
  });
});
