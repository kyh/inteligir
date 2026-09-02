// @vitest-environment jsdom

import { cleanup, fireEvent, render } from "@testing-library/react";
import type { Value } from "platejs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { findCommentMarker } from "@repo/editor/comments/comment-markers";
import {
  clearCommentMeta,
  setCommentMeta,
  setPendingCreate,
} from "@repo/editor/comments/comment-store";
import { getLiveEditor } from "@repo/editor/live-editor";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const OPEN_PATH = "open.md";
const OTHER_PATH = "other.md";
const COMMENTED = "%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n";

function openValue(): Value {
  const parsed = parseMarkdown(COMMENTED);
  if (!parsed.ok) throw new Error("the commented fixture must parse");
  return parsed.value;
}

function renderOpenNote() {
  const store = createOpenNoteStore();
  store.publishOpenPath(OPEN_PATH);
  return render(<EditorHarness value={openValue()} store={store} livePath={OPEN_PATH} />);
}

function tintedLeaf(view: ReturnType<typeof renderOpenNote>): string {
  const leaf = view.getByText("tinted words").closest('[data-slate-leaf="true"]');
  return leaf?.outerHTML ?? "";
}

const RESOLVED_ABC = { knownIds: new Set(["abc"]), resolvedIds: new Set(["abc"]) };

describe("the comment surface", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearCommentMeta(OPEN_PATH);
    clearCommentMeta(OTHER_PATH);
  });
  afterEach(cleanup);

  it("tints the range from the open note's own sidecar", () => {
    setCommentMeta(OPEN_PATH, RESOLVED_ABC);

    expect(tintedLeaf(renderOpenNote())).toContain("emerald");
  });

  it("ignores a sidecar published for a different note", () => {
    setCommentMeta(OTHER_PATH, RESOLVED_ABC);

    const leaf = tintedLeaf(renderOpenNote());
    expect(leaf).toContain("decoration-dotted");
    expect(leaf).not.toContain("emerald");
  });

  it("draws the create popover for the note that minted the markers", () => {
    setPendingCreate({ id: "abc", path: OPEN_PATH, rect: { bottom: 20, left: 10, top: 10 } });

    expect(renderOpenNote().getAllByLabelText("Comment")).toHaveLength(1);
  });

  it("draws no popover for a create minted in a note that is no longer open", () => {
    setPendingCreate({ id: "abc", path: OTHER_PATH, rect: { bottom: 20, left: 10, top: 10 } });

    expect(renderOpenNote().queryByLabelText("Comment")).toBeNull();
  });

  it("cancels the markers out of the document that holds them", () => {
    setPendingCreate({ id: "abc", path: OPEN_PATH, rect: { bottom: 20, left: 10, top: 10 } });

    const view = renderOpenNote();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    const editor = getLiveEditor(OPEN_PATH);
    if (editor === null) throw new Error("the mounted editor registers itself");
    expect(findCommentMarker(editor, "abc")).toBeNull();
  });
});
