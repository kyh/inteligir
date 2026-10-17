// @vitest-environment jsdom

import { deferred } from "@repo/editor/deferred";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Value } from "platejs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { findAnnotationMarker } from "@repo/editor/annotations/annotation-markers";
import {
  clearAnnotationMeta,
  setAnnotationMeta,
  setPendingCreate,
  useAnnotationSurface,
} from "@repo/editor/annotations/annotation-store";
import { getLiveEditor } from "@repo/editor/live-editor";
import { parseMarkdown } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./editor-harness";

const OPEN_PATH = "open.md";
const OTHER_PATH = "other.md";
const ANNOTATED = "%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n";

const openValue = (): Value => {
  const parsed = parseMarkdown(ANNOTATED);
  if (!parsed.ok) {
    throw new Error("the annotated fixture must parse");
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

const KNOWN_ABC = { knownIds: new Set(["abc"]) };

describe("the annotation surface", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearAnnotationMeta(OPEN_PATH);
    clearAnnotationMeta(OTHER_PATH);
  });
  afterEach(cleanup);

  it("tints the range from the open note's own store", () => {
    setAnnotationMeta(OPEN_PATH, KNOWN_ABC);

    const leaf = tintedLeaf(renderOpenNote());
    expect(leaf).toContain("bg-amber-300/20");
    expect(leaf).not.toContain("decoration-dotted");
  });

  it("ignores a store published for a different note", () => {
    setAnnotationMeta(OTHER_PATH, KNOWN_ABC);

    expect(tintedLeaf(renderOpenNote())).toContain("decoration-dotted");
  });

  it("draws the create popover for the note that minted the markers", () => {
    setPendingCreate({
      id: "abc",
      path: OPEN_PATH,
      quote: "tinted words",
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    expect(renderOpenNote().getAllByLabelText("Comment")).toHaveLength(1);
  });

  it("draws no popover for a create minted in a note that is no longer open", () => {
    setPendingCreate({
      id: "abc",
      path: OTHER_PATH,
      quote: "tinted words",
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    expect(renderOpenNote().queryByLabelText("Comment")).toBeNull();
  });

  it("cancels the markers out of the document that holds them", () => {
    setPendingCreate({
      id: "abc",
      path: OPEN_PATH,
      quote: "tinted words",
      rect: { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 },
    });

    const view = renderOpenNote();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));

    const editor = getLiveEditor(OPEN_PATH);
    if (editor === null) {
      throw new Error("the mounted editor registers itself");
    }
    expect(findAnnotationMarker(editor, "abc")).toBeNull();
  });
});

const ARMED_RECT = { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 };

const deferredCreate = (): ((ok: boolean) => void) => {
  const answer = deferred<boolean>();
  installFakeEditorHost({
    annotations: { create: () => answer.promise, edit: async () => true, open: () => {} },
  });
  return answer.resolve;
};

const saveDraft = (view: ReturnType<typeof renderOpenNote>): void => {
  fireEvent.change(view.getByLabelText("Comment"), { target: { value: "Is this right?" } });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
};

describe("an annotation create while its save is in flight", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearAnnotationMeta(OPEN_PATH);
  });
  afterEach(cleanup);

  it("keeps its markers through a dismissal and clears the create once the save lands", async () => {
    const settle = deferredCreate();
    setPendingCreate({ id: "abc", path: OPEN_PATH, quote: "tinted words", rect: ARMED_RECT });
    const view = renderOpenNote();
    saveDraft(view);
    const editor = getLiveEditor(OPEN_PATH);
    if (editor === null) {
      throw new Error("the mounted editor registers itself");
    }

    fireEvent.keyDown(view.getByLabelText("Comment"), { key: "Escape" });
    expect(findAnnotationMarker(editor, "abc")).not.toBeNull();
    fireEvent.click(view.getByRole("button", { name: "Cancel" }));
    expect(findAnnotationMarker(editor, "abc")).not.toBeNull();

    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(findAnnotationMarker(editor, "abc")).not.toBeNull();
    expect(useAnnotationSurface.getState().pendingCreate).toBeNull();
  });

  it("leaves a create armed after it in place when the save lands late", async () => {
    const settle = deferredCreate();
    setPendingCreate({ id: "abc", path: OPEN_PATH, quote: "tinted words", rect: ARMED_RECT });
    saveDraft(renderOpenNote());

    act(() => {
      setPendingCreate({ id: "later", path: OPEN_PATH, quote: "plain tail", rect: ARMED_RECT });
    });
    await act(async () => {
      settle(true);
      await Promise.resolve();
    });
    expect(useAnnotationSurface.getState().pendingCreate?.id).toBe("later");
  });
});

describe("an Enter in the annotation field", () => {
  beforeEach(() => {
    setPendingCreate(null);
    clearAnnotationMeta(OPEN_PATH);
  });
  afterEach(cleanup);

  it("commits an IME candidate rather than saving the half-composed note", async () => {
    const create = vi.fn<(id: string, quote: string) => Promise<boolean>>(async () => true);
    const edit = vi.fn<(id: string, text: string) => Promise<boolean>>(async () => true);
    installFakeEditorHost({ annotations: { create, edit, open: () => {} } });
    setPendingCreate({ id: "abc", path: OPEN_PATH, quote: "tinted words", rect: ARMED_RECT });
    const field = renderOpenNote().getByLabelText("Comment");
    fireEvent.change(field, { target: { value: "日本" } });

    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    expect(create).not.toHaveBeenCalled();

    fireEvent.change(field, { target: { value: "日本語" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      await Promise.resolve();
    });
    expect(create).toHaveBeenCalledExactlyOnceWith("abc", "tinted words");
    expect(edit).toHaveBeenCalledExactlyOnceWith("abc", "日本語");
  });
});
