// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { act, createRef } from "react";
import type { Path, TRange, Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  collectFindMatches,
  cycleFindMatch,
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

const mountEditor = (value: Value = VALUE): PlateEditor => {
  const holder = createRef<PlateEditor>();
  render(<EditorHarness value={value} store={STORE} ref={holder} />);
  const editor = holder.current;
  if (editor === null) {
    throw new Error("the harness mounted no editor");
  }
  return editor;
};

const span = (path: Path, from: number, to: number): TRange => ({
  anchor: { offset: from, path },
  focus: { offset: to, path },
});

const activeMatch = (editor: PlateEditor): TRange | null =>
  getFindBarState(editor).active?.current ?? null;

const findAndReplace = (editor: PlateEditor, query: string, replacement: string): void => {
  act(() => {
    openFindBar(editor);
    setFindQuery(editor, query);
    setReplaceText(editor, replacement);
  });
};

describe("replace in the find bar", () => {
  it("replaces the active match, then makes the next one active", () => {
    const editor = mountEditor();
    findAndReplace(editor, "alpha", "omega");
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("omega beta ALPHA gamma");
    expect(activeMatch(editor)).toEqual(span([0, 0], 11, 16));
  });

  it("replaces every match, last to first, and leaves none behind", () => {
    const editor = mountEditor();
    findAndReplace(editor, "alpha", "o");
    let replaced = 0;
    act(() => {
      replaced = replaceAllMatches(editor);
    });
    expect(replaced).toBe(3);
    expect(editor.api.string([0])).toBe("o beta o gamma");
    expect(editor.api.string([1])).toBe("o again");
    expect(collectFindMatches(editor, "alpha")).toHaveLength(0);
    expect(activeMatch(editor)).toBeNull();
  });

  it("rewrites only the match after a letter whose lower case is longer", () => {
    const editor = mountEditor([{ children: [{ text: "İstanbul foo" }], type: "p" }]);
    findAndReplace(editor, "foo", "bar");
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("İstanbul bar");
  });

  it("follows the active match through an edit before it", () => {
    const editor = mountEditor();
    findAndReplace(editor, "alpha", "omega");
    act(() => {
      cycleFindMatch(editor, 1);
    });
    act(() => {
      editor.tf.insertText("big ", { at: { offset: 0, path: [0, 0] } });
    });
    expect(activeMatch(editor)).toEqual(span([0, 0], 15, 20));
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("big alpha beta omega gamma");
  });

  it("lands on the next match, rewriting nothing, when an edit took the active one", () => {
    const editor = mountEditor();
    findAndReplace(editor, "alpha", "omega");
    act(() => {
      jumpToFindMatch(editor, "alpha", 1);
    });
    act(() => {
      editor.tf.insertText("x", { at: span([0, 0], 15, 16) });
    });
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("alpha beta ALPHx gamma");
    expect(editor.api.string([1])).toBe("alpha again");
    expect(activeMatch(editor)).toEqual(span([1, 0], 0, 5));
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("alpha beta ALPHx gamma");
    expect(editor.api.string([1])).toBe("omega again");
  });

  it("never rewrites its own replacement", () => {
    const editor = mountEditor([{ children: [{ text: "a a" }], type: "p" }]);
    findAndReplace(editor, "a", "aa");
    act(() => {
      replaceActiveMatch(editor);
    });
    act(() => {
      replaceActiveMatch(editor);
    });
    expect(editor.api.string([0])).toBe("aa aa");
  });
});

describe("jumping to a match", () => {
  it("lands on the nth match in document order, opening the bar on that query", () => {
    const editor = mountEditor();
    act(() => {
      jumpToFindMatch(editor, "alpha", 2);
    });
    expect(getFindBarState(editor)).toMatchObject({ open: true, search: { query: "alpha" } });
    expect(activeMatch(editor)).toEqual(span([1, 0], 0, 5));
  });

  it("lands on the last match when the doc has fewer than asked", () => {
    const editor = mountEditor();
    act(() => {
      jumpToFindMatch(editor, "gamma", 7);
    });
    expect(activeMatch(editor)).toEqual(span([0, 0], 17, 22));
  });

  it("counts the ordinal among the matches the search's own options find", () => {
    const editor = mountEditor([{ children: [{ text: "cat Cat" }], type: "p" }]);
    act(() => {
      jumpToFindMatch(editor, "Cat", 0, { caseSensitive: true, wholeWord: false });
    });
    expect(activeMatch(editor)).toEqual(span([0, 0], 4, 7));
  });
});
