import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { posOf, stateWithStack, widgetRanges } from "./helpers";

const doc = `start here

Inline $a^2 + b^2 = c^2$ in a sentence.

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$

A padded $ not math $ span, and an escaped \\$5 price.

Broken: $\\frobnicate{x}$ still shows its source.
`;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

describe("math decorations", () => {
  const state = stateWithStack(doc, 0);
  const widgets = widgetRanges(state.field(foldExtension));

  test("tight inline math folds to a widget over the whole `$…$`", () => {
    const from = posOf(doc, "$a^2 + b^2 = c^2$");
    expect(widgets).toContainEqual([from, from + "$a^2 + b^2 = c^2$".length]);
  });

  test("a `$$` block folds to a widget spanning its whole block", () => {
    const from = posOf(doc, "$$\n\\int");
    const to = posOf(doc, "$$\n\nA padded") + 2;
    expect(widgets).toContainEqual([from, to]);
  });

  test("a padded `$ … $` is not math and gets no widget", () => {
    const from = posOf(doc, "$ not math $");
    expect(widgets.some(([start]) => start === from)).toBe(false);
  });

  test("a selection inside the formula reveals the source", () => {
    const from = posOf(doc, "$a^2 + b^2 = c^2$");
    const touching = stateWithStack(doc, from + 3);
    expect(widgetRanges(touching.field(foldExtension))).not.toContainEqual([
      from,
      from + "$a^2 + b^2 = c^2$".length,
    ]);
  });
});

describe("math rendering", () => {
  test("KaTeX renders inline and display formulas, and the buffer is untouched", () => {
    editor = createMarkdownEditor({ parent: document.body, doc });
    const dom = editor.view.contentDOM;
    expect(dom.querySelectorAll(".cm-math-inline .katex").length).toBeGreaterThan(0);
    expect(dom.querySelectorAll(".cm-math-display .katex").length).toBeGreaterThan(0);
    expect(editor.getDoc()).toBe(doc);
  });

  test("an unparseable formula renders its source AND the reason, never a gap", () => {
    editor = createMarkdownEditor({ parent: document.body, doc });
    const failed = editor.view.contentDOM.querySelector(".cm-math-error");
    expect(failed).not.toBeNull();
    expect(failed?.querySelector(".cm-math-error-source")?.textContent).toBe("$\\frobnicate{x}$");
    const message = failed?.querySelector(".cm-math-error-message")?.textContent ?? "";
    expect(message.length).toBeGreaterThan(0);
    expect(message).toContain("frobnicate");
  });

  test("typing a formula in renders it without rewriting a byte", () => {
    const source = "text\n";
    editor = createMarkdownEditor({ parent: document.body, doc: source });
    editor.view.dispatch({
      changes: { from: source.length, insert: "\n$x_1$\n" },
      userEvent: "input.type",
    });
    editor.view.dispatch({ selection: { anchor: 0 } });
    expect(editor.getDoc()).toBe(`${source}\n$x_1$\n`);
    expect(editor.view.contentDOM.querySelectorAll(".cm-math-inline .katex").length).toBe(1);
  });
});
