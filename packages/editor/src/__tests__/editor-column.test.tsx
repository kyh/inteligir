import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { EditorColumn } from "@repo/editor/editor-column";
import { OpenNoteStoreProvider } from "@repo/editor/note/open-note-context";
import { createOpenNoteStore } from "@repo/editor/note/open-note-store";
import type { OpenNoteStore } from "@repo/editor/note/open-note-store";
import { installFakeEditorHost } from "@repo/editor/test-support/fake-editor-host";

// a .txt note draws the plain textarea, so the case needs no Plate tree to find the body.
const showNote = (store: OpenNoteStore, path: string): void => {
  store.publishOpenPath(path);
  store.publishEditor({ content: "body", dirty: false, diskSeq: 1, path, saveError: null });
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
