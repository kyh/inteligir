import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EditorColumn } from "@repo/editor/editor-column";
import { EditorProfileProvider } from "@repo/editor/editor-profile";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

// a .txt note draws the plain textarea, so the case needs no Plate tree to find the body.
const showNote = (store: OpenNoteStore, path: string, content = "body"): void => {
  store.publishOpenPath(path);
  store.publishEditor({
    content,
    dirty: false,
    diskSeq: 1,
    kind: "open",
    path,
    saveError: null,
  });
};

const retitle = (text: string): void => {
  const title = screen.getByRole("heading", { level: 1 });
  title.focus();
  title.textContent = text;
  fireEvent.keyDown(title, { key: "Enter" });
  fireEvent.blur(title);
};

describe("Enter in the note's title", () => {
  it("hands the caret to the body only once a rename has carried the note", async () => {
    const rename: PromiseWithResolvers<boolean> = Promise.withResolvers();
    installFakeEditorHost({ renameEntry: async () => await rename.promise });
    const store = createOpenNoteStore();
    showNote(store, "a.txt");
    render(
      <OpenNoteStoreProvider store={store}>
        <EditorColumn />
      </OpenNoteStoreProvider>,
    );

    retitle("b");
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));

    await act(async () => {
      rename.resolve(true);
      await rename.promise;
    });
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));

    act(() => {
      showNote(store, "b.txt");
    });
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("hands the caret straight over when the title did not change", () => {
    installFakeEditorHost();
    const store = createOpenNoteStore();
    showNote(store, "a.txt");
    render(
      <OpenNoteStoreProvider store={store}>
        <EditorColumn />
      </OpenNoteStoreProvider>,
    );

    retitle("a");
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });
});

describe("the hand the host draws the column for", () => {
  const OUTLINED = "# One\n\ntext\n\n## Two\n\ntext\n\n## Three\n\ntext\n";

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("is the desktop's when no host names one: the outline rail, no keyboard toolbar", () => {
    /* oxlint-disable class-methods-use-this -- the observer's instance API: `new ResizeObserver()` reaches these on the instance, never as statics */
    class ResizeObserverStub {
      observe = (): void => {};
      unobserve = (): void => {};
      disconnect = (): void => {};
    }
    /* oxlint-enable class-methods-use-this */
    vi.stubGlobal("ResizeObserver", ResizeObserverStub);
    installFakeEditorHost();
    const store = createOpenNoteStore();
    showNote(store, "a.md", OUTLINED);
    render(
      <OpenNoteStoreProvider store={store}>
        <EditorColumn />
      </OpenNoteStoreProvider>,
    );

    expect(screen.getByRole("navigation", { name: "Table of contents" })).toBeTruthy();
    expect(screen.queryByRole("toolbar", { name: "Formatting" })).toBeNull();
  });

  it("mounts the touch kit under a touch host: the keyboard toolbar, no outline rail", () => {
    installFakeEditorHost();
    const store = createOpenNoteStore();
    showNote(store, "a.md", OUTLINED);
    render(
      <EditorProfileProvider profile="touch">
        <OpenNoteStoreProvider store={store}>
          <EditorColumn />
        </OpenNoteStoreProvider>
      </EditorProfileProvider>,
    );

    expect(screen.getByRole("toolbar", { name: "Formatting" })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Table of contents" })).toBeNull();
  });
});
