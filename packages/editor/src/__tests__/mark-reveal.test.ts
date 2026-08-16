import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, test } from "vitest";
import { createMarkdownEditor } from "../create-markdown-editor";
import { selectionRebuildFilter } from "../vendor/prosemark/lib/decoration-update-filter";
import { hideExtension } from "../vendor/prosemark/lib/hide/core";
import { posOf, rangesWithClass, stateWithStack } from "./helpers";

const doc = "away\n\nSome **bold** words.\n";
const boldMarks = (): [[number, number], [number, number]] => {
  const bold = posOf(doc, "**bold**");
  return [
    [bold, bold + 2],
    [bold + 6, bold + 8],
  ];
};

const hiddenRanges = (state: EditorView["state"]): [number, number][] =>
  rangesWithClass(state.field(hideExtension), "cm-hidden-token");

describe("mark reveal on selection", () => {
  test("marks hide while the selection is elsewhere", () => {
    const state = stateWithStack(doc, 0);
    const [open, close] = boldMarks();
    expect(hiddenRanges(state)).toContainEqual(open);
    expect(hiddenRanges(state)).toContainEqual(close);
  });

  test("marks reveal when the selection touches the node", () => {
    const inside = posOf(doc, "bold") + 1;
    const state = stateWithStack(doc, inside);
    const [open, close] = boldMarks();
    expect(hiddenRanges(state)).not.toContainEqual(open);
    expect(hiddenRanges(state)).not.toContainEqual(close);
  });

  test("moving the selection in and back out re-hides", () => {
    const [open] = boldMarks();
    const away = stateWithStack(doc, 0);
    const entered = away.update({
      selection: EditorSelection.single(posOf(doc, "bold") + 1),
    }).state;
    expect(hiddenRanges(entered)).not.toContainEqual(open);
    const left = entered.update({
      selection: EditorSelection.single(0),
    }).state;
    expect(hiddenRanges(left)).toContainEqual(open);
  });

  test("a selection range (not just the caret) touching the node reveals", () => {
    const bold = posOf(doc, "**bold**");
    const state = stateWithStack(doc, 0).update({
      selection: EditorSelection.range(0, bold + 3),
    }).state;
    expect(hiddenRanges(state)).not.toContainEqual([bold, bold + 2]);
  });
});

describe("the selection-rebuild seam (drag-freeze foundation)", () => {
  test("a vetoing filter defers selection-only rebuilds; doc changes rebuild", () => {
    const [open] = boldMarks();
    const frozen = stateWithStack(
      doc,
      0,
      selectionRebuildFilter.of(() => false),
    );
    expect(hiddenRanges(frozen)).toContainEqual(open);

    // Selection moves inside the bold node, but the veto defers the rebuild:
    // the marks stay hidden.
    const moved = frozen.update({
      selection: EditorSelection.single(posOf(doc, "bold") + 1),
    }).state;
    expect(hiddenRanges(moved)).toContainEqual(open);

    // A doc change must always rebuild, veto or not.
    const edited = moved.update({
      changes: { from: moved.doc.length, insert: "x" },
    }).state;
    expect(hiddenRanges(edited)).not.toContainEqual(open);
  });
});

describe("drag freeze over a live view", () => {
  let view: EditorView | undefined;
  afterEach(() => {
    view?.destroy();
    view = undefined;
  });

  test("pointer drag freezes decorations; release rebuilds once", () => {
    const editor = createMarkdownEditor({
      parent: document.body,
      doc,
    });
    view = editor.view;
    const [open] = boldMarks();
    expect(hiddenRanges(view.state)).toContainEqual(open);

    view.contentDOM.dispatchEvent(new MouseEvent("pointerdown", { button: 0, bubbles: true }));
    view.dispatch({
      selection: EditorSelection.single(posOf(doc, "bold") + 1),
    });
    // Frozen mid-drag: the reveal is deferred.
    expect(hiddenRanges(view.state)).toContainEqual(open);

    window.dispatchEvent(new MouseEvent("pointerup"));
    // Released: the nudge rebuilt with the settled selection.
    expect(hiddenRanges(view.state)).not.toContainEqual(open);
  });
});
