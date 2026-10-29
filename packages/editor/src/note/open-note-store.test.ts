import { describe, expect, it } from "vitest";

import { createOpenNoteStore, historyStep } from "@repo/editor/note/open-note-store";
import type { OpenNoteState } from "@repo/editor/note/open-note-store";
import type { OpenEditorState } from "@repo/editor/vault-editor";

const opened = (path: string, content: string, diskSeq = 1): OpenEditorState => ({
  content,
  dirty: false,
  diskSeq,
  kind: "open",
  path,
  saveError: null,
});

const recordStates = (store: ReturnType<typeof createOpenNoteStore>) => {
  const seen: OpenNoteState[] = [];
  const stop = store.store.subscribe((state) => {
    seen.push(state);
  });
  return { seen, stop };
};

describe("the open note's store", () => {
  it("names the doc the open path loaded, and loading while it reads", () => {
    const store = createOpenNoteStore();
    store.publishOpenPath("notes/a.md");
    expect(store.state().openDoc).toEqual({ kind: "loading", path: "notes/a.md" });
    store.publishEditor(opened("notes/a.md", "# A\n"));
    expect(store.state().openDoc).toEqual({ kind: "markdown", path: "notes/a.md" });
    store.publishOpenPath("notes/readme.txt");
    store.publishEditor(opened("notes/readme.txt", "plain"));
    expect(store.state().openDoc).toEqual({ kind: "non-markdown", path: "notes/readme.txt" });
  });

  it("never shows a new path's bytes under the old path's doc", () => {
    const store = createOpenNoteStore();
    store.publishOpenPath("a.md");
    store.publishEditor(opened("a.md", "A\n"));
    const { seen, stop } = recordStates(store);
    store.publishOpenPath("b.md");
    store.publishEditor(opened("b.md", "B\n"));
    stop();
    for (const state of seen) {
      if (state.editor.kind === "open" && state.editor.content === "B\n") {
        expect(state.openDoc).toEqual({ kind: "markdown", path: "b.md" });
      }
    }
  });

  it("keeps the doc's identity across keystrokes, so its readers do not draw again", () => {
    const store = createOpenNoteStore();
    store.publishOpenPath("a.md");
    store.publishEditor(opened("a.md", "A\n"));
    const before = store.state().openDoc;
    store.publishEditor({ ...opened("a.md", "A typed\n"), dirty: true });
    expect(store.state().openDoc).toBe(before);
  });

  it("closes the editor when the library is shown, a step Forward undoes", () => {
    const store = createOpenNoteStore();
    store.publishOpenPath("a.md");
    store.publishEditor(opened("a.md", "A\n"));
    store.publishOpenPath(null);
    expect(store.state().editor).toEqual({ kind: "closed" });
    expect(store.state().openDoc).toEqual({ kind: "none" });
    expect(historyStep(store.state(), "back")).toBeNull();
    expect(historyStep(store.state(), "forward")).toEqual({ to: "a.md" });
  });

  it("carries a renamed note's history entries to its new path", () => {
    const store = createOpenNoteStore();
    for (const path of ["a.md", "b.md", "c.md", "a.md"]) {
      store.publishOpenPath(path);
    }
    store.publishOpenPath("d.md", "carry");
    expect(store.state().back).toEqual([null, "d.md", "b.md", "c.md"]);
  });
});
