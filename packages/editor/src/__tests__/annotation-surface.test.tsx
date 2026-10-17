// @vitest-environment jsdom

import { deferred } from "@repo/editor/deferred";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import type { Value } from "platejs";
import type { PlateEditor } from "platejs/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ANNOTATION_QUOTE_MAX } from "@repo/notes/annotations/store-schema";
import {
  ANNOTATION_SHORTCUTS,
  HIGHLIGHT_SHORTCUT,
  beginHighlight,
} from "@repo/editor/annotations/annotation-kit";
import { findAnnotationMarker } from "@repo/editor/annotations/annotation-markers";
import {
  clearAnnotationMeta,
  setAnnotationMeta,
  setPendingNote,
  useAnnotationSurface,
} from "@repo/editor/annotations/annotation-store";
import { editorShortcutFor } from "@repo/editor/editor-shortcuts";
import type { AnnotationActions } from "@repo/editor/host-io";
import { getLiveEditor } from "@repo/editor/live-editor";
import { parseMarkdown, serializeNote } from "@repo/editor/markdown/markdown-doc";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

import { EditorHarness } from "./editor-harness";

const OPEN_PATH = "open.md";
const OTHER_PATH = "other.md";
const ANNOTATED = "%%i:abc:start%%tinted words%%i:abc:end%% and plain tail\n";
const PLAIN = "plain words here\n";

const valueOf = (markdown: string): Value => {
  const parsed = parseMarkdown(markdown);
  if (!parsed.ok) {
    throw new Error("the fixture must parse");
  }
  return parsed.value;
};

const renderOpenNote = (markdown = ANNOTATED) => {
  const store = createOpenNoteStore();
  store.publishOpenPath(OPEN_PATH);
  return render(<EditorHarness value={valueOf(markdown)} store={store} livePath={OPEN_PATH} />);
};

const liveEditor = (): PlateEditor => {
  const editor = getLiveEditor(OPEN_PATH);
  if (editor === null) {
    throw new Error("the mounted editor registers itself");
  }
  return editor;
};

const tintedLeaf = (view: ReturnType<typeof renderOpenNote>): string => {
  const leaf = view.getByText("tinted words").closest('[data-slate-leaf="true"]');
  return leaf?.outerHTML ?? "";
};

const KNOWN_ABC = { knownIds: new Set(["abc"]), notedIds: new Set<string>() };
const RECT = { bottom: 20, height: 0, left: 10, right: 10, top: 10, width: 0 };

const armed = (path: string, created: Promise<boolean> = Promise.resolve(true)): void => {
  setPendingNote({ created, id: "abc", path, rect: RECT });
};

const hostAnswering = (answer: boolean) => {
  const create = vi.fn<AnnotationActions["create"]>(async () => await Promise.resolve(answer));
  const edit = vi.fn<AnnotationActions["edit"]>(async () => await Promise.resolve(true));
  installFakeEditorHost({ annotations: { create, edit, open: () => {} } });
  return { create, edit };
};

// the words "plain words" of PLAIN
const selectPlainWords = (editor: PlateEditor): void => {
  editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 11, path: [0, 0] } });
};

// the selection and the gesture in one act, deselected after: the selection toolbar, which jsdom
// cannot measure, never wakes
const highlightOver = (editor: PlateEditor, select: () => void): boolean => {
  let began = false;
  act(() => {
    select();
    began = beginHighlight(editor);
    editor.tf.deselect();
  });
  return began;
};

const markedId = (editor: PlateEditor): string | null => {
  const match = /%%i:(?<id>[a-z0-9]+):start%%/u.exec(serializeNote(editor));
  return match?.groups?.id ?? null;
};

describe("the highlight tint", () => {
  beforeEach(() => {
    setPendingNote(null);
    clearAnnotationMeta(OPEN_PATH);
    clearAnnotationMeta(OTHER_PATH);
  });
  afterEach(cleanup);

  it("tints the range from the open item's own store", () => {
    setAnnotationMeta(OPEN_PATH, KNOWN_ABC);

    const leaf = tintedLeaf(renderOpenNote());
    expect(leaf).toContain("bg-highlight");
    expect(leaf).not.toContain("decoration-dotted");
  });

  it("underlines an id the store does not hold, dotted, with no tint", () => {
    setAnnotationMeta(OTHER_PATH, KNOWN_ABC);

    const leaf = tintedLeaf(renderOpenNote());
    expect(leaf).toContain("decoration-dotted");
    expect(leaf).not.toContain("bg-highlight");
  });

  it("marks only a noted highlight in the gutter", () => {
    setAnnotationMeta(OPEN_PATH, KNOWN_ABC);
    expect(renderOpenNote().queryByRole("button", { name: "Highlights on this block" })).toBeNull();
    cleanup();

    setAnnotationMeta(OPEN_PATH, { knownIds: new Set(["abc"]), notedIds: new Set(["abc"]) });
    expect(
      renderOpenNote().getAllByRole("button", { name: "Highlights on this block" }),
    ).toHaveLength(1);
  });
});

describe("the note popover", () => {
  beforeEach(() => {
    setPendingNote(null);
    clearAnnotationMeta(OPEN_PATH);
  });
  afterEach(cleanup);

  it("draws over the item that made the highlight", () => {
    armed(OPEN_PATH);
    const field = renderOpenNote().getByLabelText("Note");
    expect(field.getAttribute("placeholder")).toBe("Add a note…");
  });

  it("draws nothing for a highlight made in an item that is no longer open", () => {
    armed(OTHER_PATH);
    expect(renderOpenNote().queryByLabelText("Note")).toBeNull();
  });

  it("keeps the bare highlight on Escape, writing no note", () => {
    const { edit } = hostAnswering(true);
    armed(OPEN_PATH);
    const view = renderOpenNote();

    fireEvent.change(view.getByLabelText("Note"), { target: { value: "never mind" } });
    fireEvent.keyDown(view.getByLabelText("Note"), { key: "Escape" });

    expect(useAnnotationSurface.getState().pendingNote).toBeNull();
    expect(findAnnotationMarker(liveEditor(), "abc")).not.toBeNull();
    expect(edit).not.toHaveBeenCalled();
  });

  it("writes the note on Return, once the highlight's own entry has landed", async () => {
    const created = deferred<boolean>();
    const { edit } = hostAnswering(true);
    armed(OPEN_PATH, created.promise);
    const view = renderOpenNote();

    fireEvent.change(view.getByLabelText("Note"), { target: { value: "  Is this right?  " } });
    fireEvent.keyDown(view.getByLabelText("Note"), { key: "Enter" });
    expect(useAnnotationSurface.getState().pendingNote).toBeNull();
    await Promise.resolve();
    expect(edit).not.toHaveBeenCalled();

    await act(async () => {
      created.resolve(true);
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(edit).toHaveBeenCalledExactlyOnceWith("abc", "Is this right?");
    });
  });

  it("writes no note on a highlight the host refused", async () => {
    const { edit } = hostAnswering(true);
    armed(OPEN_PATH, Promise.resolve(false));
    const view = renderOpenNote();

    fireEvent.change(view.getByLabelText("Note"), { target: { value: "why?" } });
    await act(async () => {
      fireEvent.keyDown(view.getByLabelText("Note"), { key: "Enter" });
      await Promise.resolve();
    });
    expect(edit).not.toHaveBeenCalled();
  });

  it("commits an IME candidate rather than saving the half-composed note", async () => {
    const { edit } = hostAnswering(true);
    armed(OPEN_PATH);
    const field = renderOpenNote().getByLabelText("Note");
    fireEvent.change(field, { target: { value: "日本" } });

    fireEvent.keyDown(field, { isComposing: true, key: "Enter" });
    expect(useAnnotationSurface.getState().pendingNote).not.toBeNull();

    fireEvent.change(field, { target: { value: "日本語" } });
    await act(async () => {
      fireEvent.keyDown(field, { key: "Enter" });
      await Promise.resolve();
    });
    await vi.waitFor(() => {
      expect(edit).toHaveBeenCalledExactlyOnceWith("abc", "日本語");
    });
  });
});

// jsdom cannot host Plate's editable keydown, so the chord is resolved from its table and the
// handler's body, `beginHighlight`, is run on the mounted editor
describe("the highlight gesture", () => {
  beforeEach(() => {
    setPendingNote(null);
    clearAnnotationMeta(OPEN_PATH);
  });
  afterEach(cleanup);

  it("is ⌘⇧H in the editor's chord table", () => {
    expect(HIGHLIGHT_SHORTCUT.hotkey).toBe("mod+shift+h");
    const chord = {
      altKey: false,
      ctrlKey: true,
      key: "h",
      keyCode: 72,
      metaKey: false,
      preventDefault: () => {},
      shiftKey: true,
      which: 72,
    };
    expect(editorShortcutFor(ANNOTATION_SHORTCUTS, chord)?.action).toBe("highlight");
  });

  it("writes the markers and asks for the bare entry at once, then offers the note", async () => {
    const { create, edit } = hostAnswering(true);
    renderOpenNote(PLAIN);
    const editor = liveEditor();

    expect(
      highlightOver(editor, () => {
        selectPlainWords(editor);
      }),
    ).toBe(true);

    const id = markedId(editor);
    expect(id).not.toBeNull();
    expect(serializeNote(editor)).toBe(
      `%%i:${String(id)}:start%%plain words%%i:${String(id)}:end%% here\n`,
    );
    expect(create).toHaveBeenCalledExactlyOnceWith(id, "plain words");
    expect(useAnnotationSurface.getState().pendingNote?.id).toBe(id);
    await Promise.resolve();
    expect(edit).not.toHaveBeenCalled();
  });

  it("clips a long selection's quote rather than refusing it", () => {
    const { create } = hostAnswering(true);
    const long = `${"word ".repeat(1200).trim()}\n`;
    renderOpenNote(long);
    const editor = liveEditor();
    highlightOver(editor, () => {
      editor.tf.select({
        anchor: { offset: 0, path: [0, 0] },
        focus: { offset: long.length - 1, path: [0, 0] },
      });
    });
    const quote = create.mock.calls[0]?.[1] ?? "";
    expect(quote.length).toBeLessThanOrEqual(ANNOTATION_QUOTE_MAX);
    expect(quote.endsWith("…")).toBe(true);
  });

  it("strips the markers of a highlight the host refused, and closes its popover", async () => {
    hostAnswering(false);
    renderOpenNote(PLAIN);
    const editor = liveEditor();
    highlightOver(editor, () => {
      selectPlainWords(editor);
    });
    await vi.waitFor(() => {
      expect(serializeNote(editor)).toBe(PLAIN);
    });
    expect(useAnnotationSurface.getState().pendingNote).toBeNull();
  });

  it("does nothing over a collapsed selection", () => {
    const { create } = hostAnswering(true);
    renderOpenNote(PLAIN);
    const editor = liveEditor();
    expect(
      highlightOver(editor, () => {
        editor.tf.select({ offset: 3, path: [0, 0] });
      }),
    ).toBe(false);
    expect(create).not.toHaveBeenCalled();
    expect(serializeNote(editor)).toBe(PLAIN);
  });
});
