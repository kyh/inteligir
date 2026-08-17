import { foldable } from "@codemirror/language";
import { describe, expect, test } from "vitest";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { hideExtension } from "../vendor/prosemark/lib/hide/core";
import { posOf, rangesWithClass, stateWithStack, widgetRanges } from "./helpers";

const doc = `---
title: Test note
---

# Heading one

Some **bold** and _em_ and \`code\` and ~~gone~~ text.

A [label](https://example.com) link -- with dashes.

> quoted line

- plain item
- [ ] open task
- [x] done task

***

\`\`\`js
const x = 1;
\`\`\`
`;

// The caret parks on the blank line after the frontmatter — outside every
// construct — so all of them decorate as "not near the selection".
const CARET = posOf(doc, "\n\n# Heading") + 1;

describe("hide decorations", () => {
  const state = stateWithStack(doc, CARET);
  const hidden = rangesWithClass(state.field(hideExtension), "cm-hidden-token");
  const transparent = rangesWithClass(state.field(hideExtension), "cm-transparent-token");

  test("emphasis marks hide", () => {
    const bold = posOf(doc, "**bold**");
    expect(hidden).toContainEqual([bold, bold + 2]);
    expect(hidden).toContainEqual([bold + 6, bold + 8]);
    const em = posOf(doc, "_em_");
    expect(hidden).toContainEqual([em, em + 1]);
    expect(hidden).toContainEqual([em + 3, em + 4]);
  });

  test("inline code marks hide and the span styles as code", () => {
    const code = posOf(doc, "`code`");
    expect(hidden).toContainEqual([code, code + 1]);
    expect(hidden).toContainEqual([code + 5, code + 6]);
    expect(rangesWithClass(state.field(hideExtension), "cm-inline-code")).toContainEqual([
      code,
      code + 6,
    ]);
  });

  test("strikethrough marks hide", () => {
    const gone = posOf(doc, "~~gone~~");
    expect(hidden).toContainEqual([gone, gone + 2]);
    expect(hidden).toContainEqual([gone + 6, gone + 8]);
  });

  test("link renders: every mark and the URL hide, whole link styles as a link", () => {
    const link = posOf(doc, "[label](https://example.com)");
    const url = posOf(doc, "https://example.com");
    // LinkMark by LinkMark: `[`, `]`, `(`, then the URL, then `)`.
    expect(hidden).toContainEqual([link, link + 1]);
    expect(hidden).toContainEqual([link + 6, link + 7]);
    expect(hidden).toContainEqual([link + 7, link + 8]);
    expect(hidden).toContainEqual([url, url + "https://example.com".length]);
    expect(hidden).toContainEqual([link + 27, link + 28]);
    expect(rangesWithClass(state.field(hideExtension), "cm-rendered-link")).toContainEqual([
      link,
      link + "[label](https://example.com)".length,
    ]);
  });

  test("heading hashes hang in the margin instead of hiding", () => {
    const heading = posOf(doc, "# Heading one");
    const headingLine = state.doc.lineAt(heading);
    expect(rangesWithClass(state.field(hideExtension), "cm-heading-hash")).toContainEqual([
      heading,
      heading + 2,
    ]);
    expect(rangesWithClass(state.field(hideExtension), "cm-heading-hang")).toContainEqual([
      headingLine.from,
      headingLine.from,
    ]);
    // The hash is NOT font-size-zero hidden — it hangs, visibly.
    expect(hidden).not.toContainEqual([heading, heading + 2]);
  });

  test("blockquote and fence marks keep their space", () => {
    const quote = posOf(doc, "> quoted");
    expect(transparent).toContainEqual([quote, quote + 1]);
    const fence = posOf(doc, "```js");
    expect(transparent).toContainEqual([fence, fence + 3]);
    expect(transparent).toContainEqual([fence + 3, fence + 5]);
  });
});

describe("fold decorations", () => {
  const state = stateWithStack(doc, CARET);
  const widgets = widgetRanges(state.field(foldExtension));

  test("bullet list marks fold to a bullet widget", () => {
    const item = posOf(doc, "- plain item");
    expect(widgets).toContainEqual([item, item + 1]);
  });

  test("task markers fold to a checkbox covering the whole prefix", () => {
    const open = posOf(doc, "- [ ] open task");
    const done = posOf(doc, "- [x] done task");
    expect(widgets).toContainEqual([open, open + 5]);
    expect(widgets).toContainEqual([done, done + 5]);
  });

  test("horizontal rule folds to a rule widget", () => {
    const rule = posOf(doc, "***");
    expect(widgets).toContainEqual([rule, rule + 3]);
  });

  test("double dash folds to an en dash widget", () => {
    const dash = posOf(doc, "-- with dashes");
    expect(widgets).toContainEqual([dash, dash + 2]);
  });
});

describe("frontmatter", () => {
  test("the block is foldable down to its opening line", () => {
    const state = stateWithStack(doc, CARET);
    const openingLine = state.doc.line(1);
    const range = foldable(state, openingLine.from, openingLine.to);
    expect(range).toEqual({
      from: openingLine.to,
      to: posOf(doc, "---\n\n# Heading") + 3,
    });
  });
});

describe("link forms", () => {
  const linkDoc = `start here

Titled [t](https://x.dev "my title") link.

Full [ref link][id] reference and bare [alone] brackets.

[id]: https://y.dev
`;
  const state = stateWithStack(linkDoc, 0);
  const hidden = rangesWithClass(state.field(hideExtension), "cm-hidden-token");

  test("a link title hides with the URL", () => {
    const title = posOf(linkDoc, '"my title"');
    expect(hidden).toContainEqual([title, title + '"my title"'.length]);
  });

  test("a reference link hides its label", () => {
    const label = posOf(linkDoc, "[id] reference");
    expect(hidden).toContainEqual([label, label + "[id]".length]);
  });

  test("bare [brackets] with no destination stay literal", () => {
    const bare = posOf(linkDoc, "[alone]");
    const hiddenInBareSpan = hidden.filter(
      ([from]) => from >= bare && from < bare + "[alone]".length,
    );
    expect(hiddenInBareSpan).toEqual([]);
  });
});

describe("escapes", () => {
  const escapeDoc = `start here

A real escape \\* and a literal \\a backslash and a trailing \\
end.
`;
  const state = stateWithStack(escapeDoc, 0);
  const hidden = rangesWithClass(state.field(hideExtension), "cm-hidden-token");

  test("only ASCII-punctuation escapes hide their backslash", () => {
    const real = posOf(escapeDoc, "\\*");
    expect(hidden).toContainEqual([real, real + 1]);
    const literal = posOf(escapeDoc, "\\a");
    expect(hidden).not.toContainEqual([literal, literal + 1]);
    const trailing = posOf(escapeDoc, "\\\nend");
    expect(hidden).not.toContainEqual([trailing, trailing + 1]);
  });
});
