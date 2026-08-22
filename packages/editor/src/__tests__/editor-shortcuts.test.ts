// The keyboard batch's routing, driven headlessly: handleEditorShortcut is
// the plugin's whole onKeyDown body, so calling it with a structural event is
// the binding minus Plate's own editable plumbing (which jsdom cannot host —
// slate's hasEditableTarget guard needs a real isContentEditable).

import { describe, expect, it } from "vitest";
import { createPlateEditor, type PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import { handleEditorShortcut, type ShortcutKeyEvent } from "@repo/editor/editor-shortcuts";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";

function press(
  editor: PlateEditor,
  key: string,
  keyCode: number,
  modifiers: { shift?: boolean } = {},
): void {
  // is-hotkey resolves "mod" to CTRL wherever no Mac platform is detectable
  // (node has no navigator), so the headless press is a ctrl chord.
  const event: ShortcutKeyEvent = {
    altKey: false,
    ctrlKey: true,
    key,
    keyCode,
    metaKey: false,
    preventDefault: () => {},
    shiftKey: modifiers.shift === true,
    which: keyCode,
  };
  handleEditorShortcut(editor, event);
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
