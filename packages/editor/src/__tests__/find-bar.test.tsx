// @vitest-environment jsdom

import { fireEvent, render } from "@testing-library/react";
import { act, createRef } from "react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import {
  collectFindMatches,
  cycleFindMatch,
  getFindBarState,
  jumpToFindMatch,
  openFindBar,
  setFindQuery,
} from "@repo/editor/find-bar";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const STORE = createOpenNoteStore();

const VALUE: Value = [{ children: [{ text: "alpha beta ALPHA gamma" }], type: "p" }];

beforeAll(() => {
  // jsdom lays nothing out; the cycle's scroll is a no-op there.
  window.HTMLElement.prototype.scrollIntoView = () => {};
});

describe("find bar", () => {
  it("highlights every case-insensitive match and tints the active one apart", () => {
    const holder = createRef<PlateEditor>();
    const view = render(<EditorHarness value={VALUE} store={STORE} ref={holder} />);
    const editor = holder.current;
    expect(editor).not.toBeNull();
    if (editor === null) {
      return;
    }

    act(() => {
      openFindBar(editor);
      setFindQuery(editor, "alpha");
    });

    expect(collectFindMatches(editor, "alpha")).toHaveLength(2);
    expect(view.getByText("1/2")).toBeDefined();

    const leaves = [...view.container.querySelectorAll('[data-slate-leaf="true"]')];
    const activeLeaves = leaves.filter((leaf) => leaf.outerHTML.includes("orange"));
    const plainMatches = leaves.filter(
      (leaf) => leaf.outerHTML.includes("yellow") && !leaf.outerHTML.includes("orange"),
    );
    expect(activeLeaves).toHaveLength(1);
    expect(plainMatches).toHaveLength(1);
    expect(activeLeaves[0]?.textContent).toBe("alpha");
    expect(plainMatches[0]?.textContent).toBe("ALPHA");

    act(() => {
      cycleFindMatch(editor, 1);
    });
    const cycled = [...view.container.querySelectorAll('[data-slate-leaf="true"]')].filter((leaf) =>
      leaf.outerHTML.includes("orange"),
    );
    expect(cycled).toHaveLength(1);
    expect(cycled[0]?.textContent).toBe("ALPHA");

    act(() => {
      setFindQuery(editor, "");
    });
    expect(getFindBarState(editor).active).toBeNull();
  });

  it("recounts when the note changes under the open bar", async () => {
    const holder = createRef<PlateEditor>();
    const view = render(<EditorHarness value={VALUE} store={STORE} ref={holder} />);
    const editor = holder.current;
    if (editor === null) {
      throw new Error("the harness mounted no editor");
    }

    act(() => {
      openFindBar(editor);
      setFindQuery(editor, "alpha");
    });
    expect(view.getByText("1/2")).toBeDefined();

    // Slate announces a change from a microtask, so the act must await it
    await act(async () => {
      editor.tf.insertText(" alpha", { at: { offset: 22, path: [0, 0] } });
    });
    expect(view.getByText("1/3")).toBeDefined();
  });

  it("draws a jump's options as chips, and a chip drops them and recounts", () => {
    const holder = createRef<PlateEditor>();
    const view = render(<EditorHarness value={VALUE} store={STORE} ref={holder} />);
    const editor = holder.current;
    if (editor === null) {
      throw new Error("the harness mounted no editor");
    }

    act(() => {
      jumpToFindMatch(editor, "alpha", 0, { caseSensitive: true, wholeWord: false });
    });
    expect(view.getByText("1/1")).toBeDefined();
    expect(view.queryByText("Whole word")).toBeNull();

    act(() => {
      fireEvent.click(view.getByText("Match case"));
    });
    expect(view.getByText("1/2")).toBeDefined();
    expect(view.queryByText("Match case")).toBeNull();
    expect(getFindBarState(editor).search).toEqual({
      options: { caseSensitive: false, wholeWord: false },
      query: "alpha",
    });
  });
});
