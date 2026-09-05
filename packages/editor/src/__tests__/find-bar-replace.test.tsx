// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { act, createRef } from "react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  collectFindMatches,
  getFindBarState,
  jumpToFindMatch,
  openFindBar,
  replaceActiveMatch,
  replaceAllMatches,
  setFindQuery,
  setReplaceText,
} from "@repo/editor/find-bar";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const STORE = createOpenNoteStore();

const VALUE: Value = [
  { children: [{ text: "alpha beta ALPHA gamma" }], type: "p" },
  { children: [{ text: "alpha again" }], type: "p" },
];

beforeAll(() => {
  // jsdom lays nothing out; the scroll into view is a no-op there.
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

function mountEditor(): PlateEditor {
  const holder = createRef<PlateEditor>();
  render(<EditorHarness value={VALUE} store={STORE} ref={holder} />);
  const editor = holder.current;
  if (editor === null) throw new Error("the harness mounted no editor");
  return editor;
}

describe("replace in the find bar", () => {
  it("replaces the active match, then makes the one that took its index active", () => {
    const editor = mountEditor();
    act(() => {
      openFindBar(editor);
      setFindQuery(editor, "alpha");
      setReplaceText(editor, "omega");
    });
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("omega beta ALPHA gamma");
    expect(getFindBarState().active).toEqual({ path: [0, 0], offset: 11 });
  });

  it("replaces every match, last to first, and leaves none behind", () => {
    const editor = mountEditor();
    act(() => {
      openFindBar(editor);
      setFindQuery(editor, "alpha");
      setReplaceText(editor, "o");
    });
    let replaced = 0;
    act(() => {
      replaced = replaceAllMatches(editor);
    });
    expect(replaced).toBe(3);
    expect(editor.api.string([0])).toBe("o beta o gamma");
    expect(editor.api.string([1])).toBe("o again");
    expect(collectFindMatches(editor, "alpha")).toHaveLength(0);
    expect(getFindBarState().active).toBeNull();
  });
});

describe("jumping to a match", () => {
  it("lands on the nth match in document order, opening the bar on that query", () => {
    const editor = mountEditor();
    act(() => {
      jumpToFindMatch(editor, "alpha", 2);
    });
    expect(getFindBarState()).toMatchObject({
      open: true,
      query: "alpha",
      active: { path: [1, 0], offset: 0 },
    });
  });

  it("lands on the last match when the doc has fewer than asked", () => {
    const editor = mountEditor();
    act(() => {
      jumpToFindMatch(editor, "gamma", 7);
    });
    expect(getFindBarState().active).toEqual({ path: [0, 0], offset: 17 });
  });
});
