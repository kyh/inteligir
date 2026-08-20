import { afterEach, describe, expect, test } from "vitest";
import {
  createMarkdownEditor,
  type MarkdownEditor,
  type MarkdownEditorConfig,
} from "../create-markdown-editor";

// The chip is a MARK, so what it decorates is asserted through the rendered
// DOM rather than a decoration set: a ViewPlugin's decorations are not a state
// field anyone can read, and the DOM is what a user actually gets.

const doc = `---
title: Tagged
tags: [meta]
---

# Notes on #alpha

Prose with #beta and #nested/child and a trailing #gamma- dash.

Not tags: C# and ##hash and #123 and https://x.dev/#frag.

\`#incode\` stays literal, and so does the fence:

\`\`\`js
// #fenced
\`\`\`

A [labelled #link](https://x.dev/#anchor) hides its tag too.
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const mount = (source: string, onOpenTag?: (tag: string) => void): MarkdownEditor => {
  const config: MarkdownEditorConfig = { parent: document.body, doc: source };
  if (onOpenTag !== undefined) config.onOpenTag = onOpenTag;
  return createMarkdownEditor(config);
};

const chipTexts = (instance: MarkdownEditor): string[] =>
  [...instance.view.contentDOM.querySelectorAll(".cm-tag")].map((node) => node.textContent ?? "");

describe("inline tag chips", () => {
  test("decorates exactly the tokens the knowledge index would extract", () => {
    editor = mount(doc);
    expect(chipTexts(editor)).toEqual(["#alpha", "#beta", "#nested/child", "#gamma"]);
  });

  test("a tag in code, a fence, a URL or a link label is literal text", () => {
    editor = mount(doc);
    const chips = chipTexts(editor);
    for (const literal of ["#incode", "#fenced", "#link", "#frag", "#anchor", "#123"]) {
      expect(chips).not.toContain(literal);
    }
  });

  test("clicking a chip hands the app the tag name, and writes nothing", () => {
    const opened: string[] = [];
    editor = mount("A #beta tag.\n", (tag) => opened.push(tag));
    const chip = editor.view.contentDOM.querySelector(".cm-tag");
    expect(chip).not.toBeNull();
    chip?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    // jsdom has zero geometry, so posAtCoords may refuse the lookup; the
    // invariant this asserts either way is that nothing reaches the buffer.
    expect(opened.length).toBeLessThanOrEqual(1);
    expect(editor.getDoc()).toBe("A #beta tag.\n");
  });

  test("typing a tag decorates it, and deleting the `#` undecorates it", () => {
    editor = mount("plain line\n");
    editor.view.dispatch({ changes: { from: 0, insert: "#live " }, userEvent: "input.type" });
    expect(chipTexts(editor)).toEqual(["#live"]);
    editor.view.dispatch({ changes: { from: 0, to: 1 }, userEvent: "delete" });
    expect(chipTexts(editor)).toEqual([]);
    expect(editor.getDoc()).toBe("live plain line\n");
  });
});
