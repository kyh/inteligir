import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { createMarkdownEditor, type MarkdownEditor } from "../create-markdown-editor";

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
});
