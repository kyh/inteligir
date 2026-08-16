import { undo } from "@codemirror/commands";
import { EditorSelection, EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";
import { externalReplaceChanges } from "../external-replace";

function mount(doc: string): MarkdownEditor {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return createMarkdownEditor({ parent, doc });
}

function placeCursor(editor: MarkdownEditor, anchor: number): void {
  editor.view.dispatch({ selection: EditorSelection.single(anchor) });
}

describe("replaceDoc", () => {
  it("replaces the whole buffer content", () => {
    const editor = mount("# One\n\nalpha\n");
    editor.replaceDoc("# One\n\nbeta\n");
    expect(editor.getDoc()).toBe("# One\n\nbeta\n");
    editor.destroy();
  });

  it("keeps the cursor in place when the change is after it", () => {
    const doc = "intro line\n\ntail\n";
    const editor = mount(doc);
    placeCursor(editor, 5);
    editor.replaceDoc("intro line\n\nreplaced tail\n");
    expect(editor.view.state.selection.main.head).toBe(5);
    editor.destroy();
  });

  it("shifts the cursor by the size delta when the change is before it", () => {
    const doc = "head\n\ncursor sits here\n";
    const editor = mount(doc);
    const anchor = doc.indexOf("cursor") + 3;
    placeCursor(editor, anchor);
    editor.replaceDoc("much longer head\n\ncursor sits here\n");
    const delta = "much longer head".length - "head".length;
    expect(editor.view.state.selection.main.head).toBe(anchor + delta);
    expect(editor.getDoc()).toBe("much longer head\n\ncursor sits here\n");
    editor.destroy();
  });

  it("clamps a cursor inside the replaced region instead of resetting it", () => {
    const doc = "keep\nREPLACED REGION\nkeep\n";
    const editor = mount(doc);
    placeCursor(editor, doc.indexOf("REGION"));
    editor.replaceDoc("keep\nx\nkeep\n");
    const head = editor.view.state.selection.main.head;
    expect(head).toBeGreaterThanOrEqual("keep\n".length);
    expect(head).toBeLessThanOrEqual("keep\nx\n".length);
    editor.destroy();
  });

  it("handles one text containing the other without overlapping trims", () => {
    const editor = mount("abab");
    editor.replaceDoc("ab");
    expect(editor.getDoc()).toBe("ab");
    editor.replaceDoc("abab");
    expect(editor.getDoc()).toBe("abab");
    editor.destroy();
  });

  it("is a no-op when the content is identical", () => {
    const editor = mount("same\n");
    placeCursor(editor, 2);
    editor.replaceDoc("same\n");
    expect(editor.getDoc()).toBe("same\n");
    expect(editor.view.state.selection.main.head).toBe(2);
    editor.destroy();
  });

  it("keeps a cursor BETWEEN two edits at its exact position", () => {
    // Edits land both above and below the cursor's line; a single
    // prefix/suffix replacement would swallow the whole middle and reset the
    // cursor — per-hunk changes must not move it at all.
    const doc = "top line\n\ncursor line here\n\nbottom line\n";
    const editor = mount(doc);
    const anchor = doc.indexOf("cursor") + 3;
    placeCursor(editor, anchor);
    editor.replaceDoc("TOP LINE!\n\ncursor line here\n\nBOTTOM LINE!\n");
    const delta = "TOP LINE!".length - "top line".length;
    expect(editor.view.state.selection.main.head).toBe(anchor + delta);
    expect(editor.getDoc()).toBe("TOP LINE!\n\ncursor line here\n\nBOTTOM LINE!\n");
    editor.destroy();
  });

  it("stays out of undo history: Undo cannot resurrect pre-external content", () => {
    const editor = mount("start\n");
    // A real user edit first, so history has something to invert.
    editor.view.dispatch({ changes: { from: 0, insert: "typed " } });
    expect(editor.getDoc()).toBe("typed start\n");
    editor.replaceDoc("external truth\n");
    undo(editor.view);
    // The undo may invert the user edit (mapped), but must never bring back
    // the pre-external buffer.
    expect(editor.getDoc()).not.toContain("typed start");
    expect(editor.getDoc()).toBe("external truth\n");
    editor.destroy();
  });
});

const rewrite = (current: string, next: string): string => {
  const state = EditorState.create({ doc: current });
  return state.update({ changes: externalReplaceChanges(current, next) }).state.doc.toString();
};

describe("externalReplaceChanges", () => {
  it("reproduces the target across edit shapes (the apply oracle)", () => {
    const cases: Array<[string, string]> = [
      ["a\nb\nc\n", "a\nB\nc\n"],
      ["a\nb\nc\n", "a\nx\nb\nc\n"],
      ["a\nb\nc\n", "a\nc\n"],
      ["a\nb", "a\nb\nc"],
      ["a\nb\n", "a\nb"],
      ["a\nb", "a\nb\n"],
      ["a\nb\nc", "b\nc"],
      ["only\n", ""],
      ["", "fresh\n"],
      ["x\ny\nz\n", "z\ny\nx\n"],
      ["-\nitem\n-\nitem\n-\n", "-\nitem edited\n-\nitem\n-\nmore\n"],
    ];
    for (const [current, next] of cases) {
      expect(rewrite(current, next)).toBe(next);
    }
  });
});
