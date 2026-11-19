import { describe, expect, it } from "vitest";
import { createPlateEditor } from "platejs/react";
import type { PlateEditor } from "platejs/react";
import type { Value } from "platejs";

import {
  EDITOR_SHORTCUTS,
  editorShortcutFor,
  handleEditorShortcut,
} from "@repo/editor/editor-shortcuts";
import type { EditorShortcut, ShortcutKeyEvent } from "@repo/editor/editor-shortcuts";
import { FIND_BAR_SHORTCUTS } from "@repo/editor/find-bar";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";

const press = (
  editor: PlateEditor,
  key: string,
  keyCode: number,
  modifiers: { shift?: boolean } = {},
) => {
  let claimed = false;

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
};

const PARAGRAPH: Value = [{ children: [{ text: "hello world" }], type: "p" }];

const mount = (value: Value) => {
  const editor = createPlateEditor({ plugins: EDITOR_KIT, value });
  editor.tf.select({ anchor: { offset: 0, path: [0, 0] }, focus: { offset: 5, path: [0, 0] } });

  return editor;
};

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

const NAMED_KEY_CODES = new Map([["enter", 13]]);

const chordEvent = (hotkey: string) => {
  const parts = hotkey.split("+");
  const key = parts.at(-1) ?? "";
  const keyCode = NAMED_KEY_CODES.get(key) ?? key.toUpperCase().codePointAt(0) ?? Number.NaN;

  return {
    altKey: parts.includes("alt"),
    ctrlKey: parts.includes("mod"),
    key,
    keyCode,
    metaKey: false,
    preventDefault: () => {},
    shiftKey: parts.includes("shift"),
    which: keyCode,
  } satisfies ShortcutKeyEvent;
};

describe("the shortcut tables", () => {
  it("resolve each row from its own chord, and no other row from it", () => {
    const tables: readonly (readonly EditorShortcut<string>[])[] = [
      EDITOR_SHORTCUTS,
      FIND_BAR_SHORTCUTS,
    ];

    for (const rows of tables) {
      for (const row of rows) {
        expect(editorShortcutFor(rows, chordEvent(row.hotkey))?.action).toBe(row.action);
      }
    }
  });
});
