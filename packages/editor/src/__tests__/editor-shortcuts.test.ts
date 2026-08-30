// The keyboard batch's routing, driven headlessly: handleEditorShortcut is
// the plugin's whole onKeyDown body, so calling it with a structural event is
// the binding minus Plate's own editable plumbing (which jsdom cannot host —
// slate's hasEditableTarget guard needs a real isContentEditable).

import { describe, expect, it, vi } from "vitest";
import { createPlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { handleEditorShortcut, type ShortcutKeyEvent } from "@repo/editor/editor-shortcuts";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { registerLiveEditor } from "@repo/editor/live-editor";
import { registerNoteTitleFocus } from "@repo/editor/note-title-focus";

/** Presses the chord and answers whether the batch claimed the key. */
function press(
  editor: PlateEditor,
  key: string,
  keyCode: number,
  modifiers: { shift?: boolean } = {},
) {
  let claimed = false;
  // is-hotkey resolves "mod" to CTRL wherever no Mac platform is detectable
  // (node has no navigator), so the headless press is a ctrl chord.
  const event: ShortcutKeyEvent = {
    altKey: false,
    ctrlKey: true,
    key,
    keyCode,
    metaKey: false,
    preventDefault: () => {
      claimed = true;
    },
    shiftKey: modifiers.shift === true,
    which: keyCode,
  };
  handleEditorShortcut(editor, event);
  return { claimed };
}

const PARAGRAPH: Value = [{ children: [{ text: "hello world" }], type: "p" }];

function mount(value: Value): PlateEditor {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 5, path: [0, 0] } });
  return editor;
}

describe("editor shortcuts", () => {
  it("⌘E toggles the inline code mark on the selection", () => {
    const editor = mount(PARAGRAPH);
    press(editor, "e", 69);
    expect(editor.children[0]?.children[0]).toMatchObject({ code: true, text: "hello" });
    press(editor, "e", 69);
    expect(editor.children[0]?.children[0]).not.toHaveProperty("code");
  });

  it("⌘E declines inside a code block", () => {
    const editor = createPlateEditor({
      plugins: EDITOR_KIT,
      value: [
        {
          children: [{ children: [{ text: "const x = 1" }], type: "code_line" }],
          type: "code_block",
        },
      ],
    });
    editor.tf.select({
      anchor: { offset: 0, path: [0, 0, 0] },
      focus: { offset: 5, path: [0, 0, 0] },
    });
    const before = JSON.stringify(editor.children);
    press(editor, "e", 69);
    expect(JSON.stringify(editor.children)).toBe(before);
  });

  it("⌘⇧C toggles the block into a to-do item and back", () => {
    const editor = mount(PARAGRAPH);
    press(editor, "c", 67, { shift: true });
    expect(editor.children[0]).toMatchObject({ checked: false, listStyleType: "todo" });
    press(editor, "c", 67, { shift: true });
    expect(editor.children[0]).not.toHaveProperty("listStyleType");
  });

  it("⌘T focuses the title of the note the pressed editor serves", () => {
    const editorA = mount(PARAGRAPH);
    const editorB = mount(PARAGRAPH);
    const offEditors = [registerLiveEditor("a.md", editorA), registerLiveEditor("b.md", editorB)];
    const focusA = vi.fn();
    const focusB = vi.fn();
    const offTitleA = registerNoteTitleFocus("a.md", focusA);
    const offTitleB = registerNoteTitleFocus("b.md", focusB);
    try {
      expect(press(editorB, "t", 84).claimed).toBe(true);
      expect(focusB).toHaveBeenCalledTimes(1);
      expect(focusA).not.toHaveBeenCalled();

      // One title going away must not take ⌘T down with it.
      offTitleB();
      expect(press(editorA, "t", 84).claimed).toBe(true);
      expect(focusA).toHaveBeenCalledTimes(1);
      expect(focusB).toHaveBeenCalledTimes(1);
    } finally {
      offTitleA();
      offTitleB();
      for (const off of offEditors) off();
    }
  });

  it("⌘T leaves the key alone when the pressed editor has no mounted title", () => {
    const editor = mount(PARAGRAPH);
    expect(press(editor, "t", 84).claimed).toBe(false);
  });

  it("⌘L and ⌘⇧L toggle bulleted and numbered lists", () => {
    const editor = mount(PARAGRAPH);
    press(editor, "l", 76);
    expect(editor.children[0]).toMatchObject({ listStyleType: "disc" });
    press(editor, "l", 76, { shift: true });
    expect(editor.children[0]).toMatchObject({ listStyleType: "decimal" });
    press(editor, "l", 76, { shift: true });
    expect(editor.children[0]).not.toHaveProperty("listStyleType");
  });
});
