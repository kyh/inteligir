// @vitest-environment jsdom

import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Value } from "platejs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findCommentMarker } from "@repo/editor/comments/comment-markers";
import {
  clearCommentMeta,
  setCommentActions,
  setCommentMeta,
  setPendingCreate,
  useCommentSurface,
} from "@repo/editor/comments/comment-store";
import { getLiveEditor } from "@repo/editor/live-editor";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";

import { EditorHarness } from "./editor-harness";

const OPEN_PATH = "open.md";
const OTHER_PATH = "other.md";
const COMMENTED = "%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n";

const openValue = (): Value => {
  const parsed = parseMarkdown(COMMENTED);
  if (!parsed.ok) {
    throw new Error("the commented fixture must parse");
  }
  return parsed.value;
};

const renderOpenNote = () => {
  const store = createOpenNoteStore();
  store.publishOpenPath(OPEN_PATH);
  return render(<EditorHarness value={openValue()} store={store} livePath={OPEN_PATH} />);
};

const tintedLeaf = (view: ReturnType<typeof renderOpenNote>): string => {
  const leaf = view.getByText("tinted words").closest('[data-slate-leaf="true"]');
  return leaf?.outerHTML ?? "";
};

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
    setPendingCreate({
      id: "abc",
      path: OPEN_PATH,
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    expect(renderOpenNote().getAllByLabelText("Comment")).toHaveLength(1);
  });

  it("draws no popover for a create minted in a note that is no longer open", () => {
    setPendingCreate({
      id: "abc",
      path: OTHER_PATH,
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    expect(renderOpenNote().queryByLabelText("Comment")).toBeNull();
  });

  it("cancels the markers out of the document that holds them", () => {
    setPendingCreate({
      id: "abc",
      path: OPEN_PATH,
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    const view = renderOpenNote();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    const editor = getLiveEditor(OPEN_PATH);
    if (editor === null) {
      throw new Error("the mounted editor registers itself");
    }
    expect(findCommentMarker(editor, "abc")).toBeNull();
  });
});

const ARMED_RECT = { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 };

const deferredCreate = (): ((ok: boolean) => void) => {
  const answer = Promise.withResolvers<boolean>();
  setCommentActions({ create: () => answer.promise, open: () => {} });
  return answer.resolve;
};

const saveDraft = (view: ReturnType<typeof renderOpenNote>): void => {
  fireEvent.change(view.getByLabelText("Comment"), { target: { value: "Is this right?" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
};

describe("a comment create while its save is in flight", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearCommentMeta(OPEN_PATH);
  });
  afterEach(() => {
    cleanup();
    setCommentActions(null);
  });

  it("keeps its markers through a dismissal and clears the create once the save lands", async () => {
    const settle = deferredCreate();
    setPendingCreate({ id: "abc", path: OPEN_PATH, rect: ARMED_RECT });
    const view = renderOpenNote();
    saveDraft(view);
    const editor = getLiveEditor(OPEN_PATH);
    if (editor === null) {
      throw new Error("the mounted editor registers itself");
    }

    fireEvent.keyDown(view.getByLabelText("Comment"), { key: "Escape" });
    expect(findCommentMarker(editor, "abc")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(findCommentMarker(editor, "abc")).not.toBeNull();

    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(findCommentMarker(editor, "abc")).not.toBeNull();
    expect(useCommentSurface.getState().pendingCreate).toBeNull();
  });

  it("leaves a create armed after it in place when the save lands late", async () => {
    const settle = deferredCreate();
    setPendingCreate({ id: "abc", path: OPEN_PATH, rect: ARMED_RECT });
    saveDraft(renderOpenNote());

    act(() => {
      setPendingCreate({ id: "later", path: OPEN_PATH, rect: ARMED_RECT });
    });
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(useCommentSurface.getState().pendingCreate?.id).toBe("later");
  });
});

describe("an Enter in the comment field", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearCommentMeta(OPEN_PATH);
  });
  afterEach(() => {
    cleanup();
    setCommentActions(null);
  });

  it("commits an IME candidate rather than saving the half-composed comment", async () => {
    const create = vi.fn<(id: string, text: string) => Promise<boolean>>(async () => true);
    setCommentActions({ create, open: () => {} });
    setPendingCreate({ id: "abc", path: OPEN_PATH, rect: ARMED_RECT });
    const field = renderOpenNote().getByLabelText("Comment");
    fireEvent.change(field, { target: { value: "日本" } });

    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "日本語" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      await Promise.resolve();
    });
    expect(create).toHaveBeenCalledExactlyOnceWith("abc", "日本語");
  });
});
