// @vitest-environment jsdom

import { act, cleanup, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { insertCommentMarkers } from "@repo/editor/comments/comment-markers";
import { clearCommentMeta, setCommentMeta } from "@repo/editor/comments/comment-store";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const NOTE_PATH = "note.md";

const valueOf = (md: string): Value => {
  const parsed = parseMarkdown(md);
  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }
  return parsed.value;
};

const renderNote = (md: string) => {
  const store = createOpenNoteStore();
  store.publishOpenPath(NOTE_PATH);
  const ref = createRef<PlateEditor>();
  const view = render(<EditorHarness value={valueOf(md)} store={store} ref={ref} />);
  return { ref, view };
};

const leafOf = (view: ReturnType<typeof render>, text: string | RegExp): string =>
  view.getByText(text).closest('[data-slate-leaf="true"]')?.outerHTML ?? "";

// with every id known to the sidecar, the dotted underline is the orphan's alone
const OPEN = "bg-amber-300/20";
const ORPHAN = "decoration-dotted";

describe("comment range decoration", () => {
  beforeEach(() => {
    setCommentMeta(NOTE_PATH, {
      knownIds: new Set(["abc", "y", "x", "mid", "c1"]),
      resolvedIds: new Set(),
    });
  });
  afterEach(() => {
    cleanup();
    clearCommentMeta(NOTE_PATH);
  });

  it("tints the text between a marker pair and leaves the tail plain", () => {
    const { view } = renderNote("%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n");
    expect(leafOf(view, "tinted words")).toContain(OPEN);
    expect(leafOf(view, /and plain tail/u)).not.toContain("amber");
  });

  it("anchors a range across two paragraphs rather than orphaning both edges", () => {
    const { view } = renderNote("first %%i:y:start%%opening\n\nclosing%%i:y:end%% tail\n");
    expect(leafOf(view, "opening")).toContain(OPEN);
    expect(leafOf(view, "closing")).toContain(OPEN);
    expect(leafOf(view, /first/u)).not.toContain("amber");
    expect(leafOf(view, /tail/u)).not.toContain("amber");
  });

  it("anchors markers on their own lines around a fence to the code between them", () => {
    const { view } = renderNote("%%i:x:start%%\n```js\nfenced code\n```\n%%i:x:end%%\n");
    expect(leafOf(view, "fenced code")).toContain(OPEN);
  });

  it("tints an untouched middle paragraph when a range is minted across it", async () => {
    const { ref, view } = renderNote("alpha one\n\nbravo two\n\ncharlie three\n");
    expect(leafOf(view, "bravo two")).not.toContain("amber");
    const editor = ref.current;
    if (editor === null) {
      throw new Error("the harness hands out its editor");
    }
    // Slate reports a change on a microtask, so the act awaits it; the deselect keeps the
    // selection toolbar, which jsdom cannot measure, from waking
    await act(async () => {
      editor.selection = {
        anchor: { offset: 6, path: [0, 0] },
        focus: { offset: 7, path: [2, 0] },
      };
      insertCommentMarkers(editor, "mid");
      editor.tf.deselect();
      await Promise.resolve();
    });
    expect(leafOf(view, "bravo two")).toContain(OPEN);
  });

  it("marks a lone edge as an orphan", () => {
    const { view } = renderNote("%%i:c1:start%%never closed\n");
    expect(leafOf(view, "never closed")).toContain(ORPHAN);
  });
});

describe("comment gutter", () => {
  beforeEach(() => {
    setCommentMeta(NOTE_PATH, { knownIds: new Set(["abc"]), resolvedIds: new Set() });
  });
  afterEach(() => {
    cleanup();
    clearCommentMeta(NOTE_PATH);
  });

  it("draws the dot beside a callout whose body a range starts in", () => {
    const { view } = renderNote(
      "```inteligir-callout\ntype: info\nopening %%i:abc:start%%words\n```\n\nclosing%%i:abc:end%% tail\n",
    );
    expect(view.getAllByRole("button", { name: "Comments on this block" })).toHaveLength(1);
  });
});
