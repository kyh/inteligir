// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { act, createRef } from "react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { beforeAll, describe, expect, it } from "vitest";

import { scrollToLinkTarget } from "@repo/editor/link-locate";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const STORE = createOpenNoteStore();

const VALUE: Value = [
  { children: [{ text: "prose before " }], type: "p" },
  {
    children: [
      { text: "see " },
      { body: "Nowhere#intro", children: [{ text: "" }], type: "wikiLink" },
      { text: " and " },
      { children: [{ text: "a doc" }], type: "a", url: "./missing.md#top" },
      { text: "." },
    ],
    type: "p",
  },
];

const NO_RECT: DOMRect = {
  x: 0,
  y: 0,
  width: 0,
  height: 0,
  top: 0,
  right: 0,
  bottom: 0,
  left: 0,
  toJSON: () => ({}),
};

beforeAll(() => {
  // jsdom lays nothing out: the scroll into view is a no-op, and the selection's DOM range
  // (which the editable measures after a select) has no box
  window.HTMLElement.prototype.scrollIntoView = () => {};
  window.Range.prototype.getBoundingClientRect = () => NO_RECT;
});

function mountEditor(): PlateEditor {
  const holder = createRef<PlateEditor>();
  render(<EditorHarness value={VALUE} store={STORE} ref={holder} />);
  const editor = holder.current;
  if (editor === null) throw new Error("the harness mounted no editor");
  return editor;
}

describe("landing on a link by its written target", () => {
  it("selects the wiki chip whose target matches, any case, anchor ignored", () => {
    const editor = mountEditor();
    let found = false;
    act(() => {
      found = scrollToLinkTarget(editor, "nowhere");
    });
    expect(found).toBe(true);
    expect(editor.selection?.anchor.path.slice(0, 2)).toEqual([1, 1]);
  });

  it("selects an md link by its url without the anchor", () => {
    const editor = mountEditor();
    let found = false;
    act(() => {
      found = scrollToLinkTarget(editor, "./missing.md");
    });
    expect(found).toBe(true);
    expect(editor.selection?.anchor.path.slice(0, 2)).toEqual([1, 3]);
  });

  it("answers false, and moves nothing, for a target the document does not carry", () => {
    const editor = mountEditor();
    let found = true;
    act(() => {
      found = scrollToLinkTarget(editor, "Elsewhere");
    });
    expect(found).toBe(false);
  });
});
