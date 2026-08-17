import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { foldExtension } from "../vendor/prosemark/lib/fold/core";
import { posOf, rangesWithClass, stateWithStack, widgetRanges } from "./helpers";

const doc = `start here

> [!NOTE] Remember this
> A second line of the same callout.

> [!warning]
> No title on this one.

> [!totally-made-up] Unknown types still get a box.

> An ordinary quote, no callout.

[!NOTE] outside a quote stays literal text.
`;

// Off every construct, so each decorates as "not near the selection".
const CARET = 0;

let editor: MarkdownEditor | undefined;
afterEach(() => {
  editor?.destroy();
  editor = undefined;
});

const calloutLines = (source: string, anchor: number): [number, number][] =>
  rangesWithClass(stateWithStack(source, anchor).field(foldExtension), "cm-callout-line");

describe("callout chrome", () => {
  const state = stateWithStack(doc, CARET);

  test("every line of a callout blockquote carries the chrome", () => {
    const lines = calloutLines(doc, CARET);
    const noteFrom = state.doc.lineAt(posOf(doc, "> [!NOTE] Remember")).from;
    const noteSecond = state.doc.lineAt(posOf(doc, "> A second line")).from;
    expect(lines).toContainEqual([noteFrom, noteFrom]);
    expect(lines).toContainEqual([noteSecond, noteSecond]);
  });

  test("a titleless callout and an unknown type both get a box", () => {
    const lines = calloutLines(doc, CARET);
    for (const marker of ["> [!warning]", "> [!totally-made-up]"]) {
      const from = state.doc.lineAt(posOf(doc, marker)).from;
      expect(lines).toContainEqual([from, from]);
    }
  });

  test("an ordinary blockquote gets no chrome", () => {
    const lines = calloutLines(doc, CARET);
    const from = state.doc.lineAt(posOf(doc, "> An ordinary quote")).from;
    expect(lines).not.toContainEqual([from, from]);
  });

  test("the header token folds to a label widget covering `[!TYPE] `", () => {
    const header = posOf(doc, "[!NOTE] Remember");
    expect(widgetRanges(state.field(foldExtension))).toContainEqual([
      header,
      header + "[!NOTE] ".length,
    ]);
  });

  test("a selection touching the header reveals it, and the box stays", () => {
    const header = posOf(doc, "[!NOTE] Remember");
    const touching = stateWithStack(doc, header + 2);
    const decorations = touching.field(foldExtension);
    expect(widgetRanges(decorations)).not.toContainEqual([header, header + "[!NOTE] ".length]);
    const from = touching.doc.lineAt(header).from;
    expect(rangesWithClass(decorations, "cm-callout-line")).toContainEqual([from, from]);
  });
});

describe("callouts in the live editor", () => {
  test("the label renders, and typing one in never rewrites the buffer", () => {
    const source = "> [!TIP] Try this\n> and this.\n";
    editor = createMarkdownEditor({ parent: document.body, doc: source });
    editor.view.dispatch({ selection: EditorSelection.single(source.length) });
    const label = editor.view.contentDOM.querySelector(".cm-callout-label");
    expect(label?.textContent).toBe("TIP");
    expect(label?.getAttribute("data-callout")).toBe("tip");

    editor.view.dispatch({
      changes: { from: source.length, insert: "\n> [!DANGER] Careful\n" },
      userEvent: "input.type",
    });
    expect(editor.getDoc()).toBe(`${source}\n> [!DANGER] Careful\n`);
  });

  test("`[!NOTE]` outside a blockquote is left alone", () => {
    const source = "[!NOTE] just text\n";
    editor = createMarkdownEditor({ parent: document.body, doc: source });
    expect(editor.view.contentDOM.querySelector(".cm-callout-label")).toBeNull();
    expect(editor.view.contentDOM.textContent).toContain("[!NOTE] just text");
  });
});
