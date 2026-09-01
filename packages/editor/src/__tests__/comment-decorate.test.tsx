// @vitest-environment jsdom

// The tint is a DECORATION, and Plate applies a decoration only to the node
// it was returned FOR — this mounts the real kit and asserts the commented
// text actually renders through CommentRangeLeaf (the regression: a
// block-level decorate produced ranges no leaf ever claimed).

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const STORE = createOpenNoteStore();

describe("comment range decoration", () => {
  it("tints the text between a marker pair and leaves the tail plain", () => {
    const parsed = parseMarkdown("%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    const view = render(<EditorHarness value={parsed.value} store={STORE} />);
    const tinted = view.getByText("tinted words");
    const tintedLeaf = tinted.closest('[data-slate-leaf="true"]');
    expect(tintedLeaf?.outerHTML ?? "").toContain("amber");
    const tail = view.getByText(/and plain tail/);
    const tailLeaf = tail.closest('[data-slate-leaf="true"]');
    expect(tailLeaf?.outerHTML ?? "").not.toContain("amber");
  });
});
