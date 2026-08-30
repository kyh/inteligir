// @vitest-environment jsdom

// The comment surface is per PANE. A split shows two notes at once, so the
// tint over a pane's bytes has to answer from THAT note's sidecar, and the
// ⌘⇧A popover has to be drawn by the pane that minted the markers — the one
// whose editor its cancel and save act on. One slot shared by both panes
// renders the background pane's comments as orphans and draws the popover
// twice, over two different documents.

import { cleanup, fireEvent, render, within } from "@testing-library/react";
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
import { createOpenNoteStore, type OpenNoteStore } from "@repo/editor/note/open-note-store";

import { PaneHarness } from "./pane-harness";

const PRIMARY_PATH = "primary.md";
const SPLIT_PATH = "split.md";

/** Both panes hold the same commented text, so only the pane identity can
 * explain a difference in how it renders. */
const COMMENTED = "%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n";

function paneStore(path: string): OpenNoteStore {
  const store = createOpenNoteStore();
  store.publishOpenPath(path);
  return store;
}

const PRIMARY = paneStore(PRIMARY_PATH);
const SPLIT = paneStore(SPLIT_PATH);

function paneValue(): Value {
  const parsed = parseMarkdown(COMMENTED);
  if (!parsed.ok) throw new Error("the commented fixture must parse");
  return parsed.value;
}

function Pane({ store, path, label }: { store: OpenNoteStore; path: string; label: string }) {
  return (
    <div data-testid={label}>
      <PaneHarness value={paneValue()} store={store} livePath={path} />
    </div>
  );
}

function renderSplit() {
  return render(
    <>
      <Pane store={PRIMARY} path={PRIMARY_PATH} label="primary" />
      <Pane store={SPLIT} path={SPLIT_PATH} label="split" />
    </>,
  );
}

/** The rendered leaf carrying the commented words in one pane. */
function tintedLeaf(view: ReturnType<typeof renderSplit>, label: string): string {
  const leaf = within(view.getByTestId(label))
    .getByText("tinted words")
    .closest('[data-slate-leaf="true"]');
  return leaf?.outerHTML ?? "";
}

describe("the comment surface in a split", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearCommentMeta(PRIMARY_PATH);
    clearCommentMeta(SPLIT_PATH);
  });
  afterEach(cleanup);

  it("tints each pane's range from its own note's sidecar", () => {
    setCommentMeta(PRIMARY_PATH, {
      knownIds: new Set(["abc"]),
      resolvedIds: new Set(["abc"]),
    });

    const view = renderSplit();

    // Known and resolved here; the split's sidecar holds nothing, so the same
    // id reads as a comment that no longer exists.
    expect(tintedLeaf(view, "primary")).toContain("emerald");
    expect(tintedLeaf(view, "split")).toContain("decoration-dotted");
    expect(tintedLeaf(view, "split")).not.toContain("emerald");
  });

  it("draws the create popover only in the pane that minted the markers", () => {
    setPendingCreate({ id: "abc", path: SPLIT_PATH, rect: { bottom: 20, left: 10, top: 10 } });

    const view = renderSplit();

    expect(within(view.getByTestId("split")).getAllByLabelText("Comment")).toHaveLength(1);
    expect(within(view.getByTestId("primary")).queryByLabelText("Comment")).toBeNull();
  });

  it("cancels out of the document that holds the markers", () => {
    setPendingCreate({ id: "abc", path: SPLIT_PATH, rect: { bottom: 20, left: 10, top: 10 } });

    const view = renderSplit();
    fireEvent.click(within(view.getByTestId("split")).getByRole("button", { name: "Cancel" }));

    const split = getLiveEditor(SPLIT_PATH);
    const primary = getLiveEditor(PRIMARY_PATH);
    if (split === null || primary === null) throw new Error("both panes register their editor");
    expect(findCommentMarker(split, "abc")).toBeNull();
    expect(findCommentMarker(primary, "abc")).not.toBeNull();
  });
});
