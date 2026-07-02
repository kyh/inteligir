// Regression suite for the inline combobox's editor-mutation core
// (combobox-input.ts), mirroring the crash recipe that tore the ariakit
// version to about:blank: trigger → typed query → Escape cancel → rapid
// undo/redo interleaving. The invariants: no operation ever throws, cancel
// after an external removal (undo) is a no-op, and the trigger elements are
// structurally excluded from serialization (no "Unreachable code" warning,
// no text drop).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementApi, KEYS, createSlateEditor, type TElement } from "platejs";
import { serializeMd } from "@platejs/markdown";

import {
  cancelComboboxInput,
  commitComboboxInput,
  racedComboboxText,
} from "@repo/app/editor/combobox-input";
import { EDITOR_KIT } from "@repo/app/editor/kits/editor-kit";
import { MD_STRINGIFY } from "@repo/app/editor/markdown/markdown-doc";

function makeEditor(text: string) {
  return createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text }], type: "p" }],
  });
}

type Editor = ReturnType<typeof makeEditor>;

function out(editor: Editor): string {
  return serializeMd(editor, { remarkStringifyOptions: MD_STRINGIFY });
}

function findByType(editor: Editor, type: string): TElement | null {
  for (const [node] of editor.api.nodes({ at: [], match: { type } })) {
    if (ElementApi.isElement(node)) return node;
  }
  return null;
}

/** Type the trigger char at the end of block 0, creating the input element. */
function openCombobox(editor: Editor, trigger: string, type: string): TElement {
  const end = editor.api.end([0]);
  if (!end) throw new Error("no end point");
  editor.tf.select(end);
  editor.tf.insertText(trigger);
  const element = findByType(editor, type);
  if (!element) throw new Error(`trigger '${trigger}' did not insert a ${type} element`);
  return element;
}

describe("inline combobox cancel safety (the about:blank crash class)", () => {
  it("escape cancel restores the trigger + query bytes", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
    cancelComboboxInput(editor, element, { cause: "escape", restoreText: ":tada" });
    expect(out(editor)).toBe("hello :tada\n");
    expect(findByType(editor, KEYS.emojiInput)).toBeNull();
  });

  it("survives the crash recipe: escape cancel → 10 rapid undos, ×5 runs", () => {
    for (let run = 0; run < 5; run++) {
      const editor = makeEditor("hello ");
      const seed = out(editor);
      const element = openCombobox(editor, ":", KEYS.emojiInput);
      cancelComboboxInput(editor, element, { cause: "escape", restoreText: ":tada" });
      expect(() => {
        for (let i = 0; i < 10; i++) editor.undo();
      }).not.toThrow();
      // Fully unwound: back to the seed bytes, no orphan trigger element.
      expect(out(editor)).toBe(seed);
      expect(findByType(editor, KEYS.emojiInput)).toBeNull();
    }
  });

  it("survives undo/redo interleaving after a cancel", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
    cancelComboboxInput(editor, element, { cause: "escape", restoreText: ":tada" });
    expect(() => {
      for (let i = 0; i < 5; i++) {
        editor.undo();
        editor.redo();
        editor.undo();
        editor.undo();
        editor.redo();
        editor.redo();
      }
    }).not.toThrow();
    // Redo replays the cancel exactly — bytes converge, never duplicate.
    expect(out(editor)).toBe("hello :tada\n");
  });

  it("cancel after an undo removed the element is a strict no-op", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
    // Cmd+Z forwarded from the input: the trigger-insert batch unwinds and
    // the element leaves the document while the component is still mounted.
    while (findByType(editor, KEYS.emojiInput)) editor.undo();
    const before = out(editor);
    expect(() =>
      cancelComboboxInput(editor, element, { cause: "deselect", restoreText: ":tada" }),
    ).not.toThrow();
    expect(out(editor)).toBe(before);
  });

  it("backspace cancel deletes the trigger too", () => {
    const editor = makeEditor("hello ");
    const seed = out(editor);
    const element = openCombobox(editor, "/", KEYS.slashInput);
    cancelComboboxInput(editor, element, { cause: "backspace", restoreText: "/" });
    expect(out(editor)).toBe(seed);
  });

  it("commit removes the element and survives undo spam", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
    commitComboboxInput(editor, element, false);
    const end = editor.api.end([0]);
    if (!end) throw new Error("no end point");
    editor.tf.insertText("🎉", { at: end });
    expect(out(editor)).toBe("hello 🎉\n");
    expect(() => {
      for (let i = 0; i < 10; i++) editor.undo();
      for (let i = 0; i < 10; i++) editor.redo();
    }).not.toThrow();
    expect(out(editor)).toBe("hello 🎉\n");
  });

  it("commit after external removal is a no-op", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, "/", KEYS.slashInput);
    while (findByType(editor, KEYS.slashInput)) editor.undo();
    expect(() => commitComboboxInput(editor, element, false)).not.toThrow();
  });

  it("absorbs keystrokes that raced into the element's hidden text child", () => {
    const editor = makeEditor("");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
    // A fast keystroke landing before the HTML input mounts goes into the
    // void's text child; the input's mount effect reads it via
    // racedComboboxText and prepends it to the query.
    const path = editor.api.findPath(element);
    if (!path) throw new Error("element path missing");
    editor.tf.select({ offset: 0, path: [...path, 0] });
    editor.tf.insertText("t", { voids: true });
    const raced = findByType(editor, KEYS.emojiInput);
    expect(raced ? racedComboboxText(raced) : "").toBe("t");
    // The raced bytes leave with the element on cancel; the restore text (the
    // component passes trigger + absorbed value) carries them instead.
    if (!raced) throw new Error("element missing");
    cancelComboboxInput(editor, raced, { cause: "escape", restoreText: ":tada" });
    expect(out(editor)).toBe(":tada\n");
  });
});

describe("combobox trigger nodes are excluded from serialization", () => {
  let warn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
  });
  afterEach(() => {
    warn.mockRestore();
  });

  it("serializing mid-combobox drops the trigger node, keeps the text, never warns", () => {
    for (const trigger of [
      { char: "/", type: KEYS.slashInput },
      { char: ":", type: KEYS.emojiInput },
    ]) {
      const editor = makeEditor("before after");
      editor.tf.select({ offset: 7, path: [0, 0] });
      editor.tf.insertText(trigger.char);
      expect(findByType(editor, trigger.type)).not.toBeNull();
      const md = out(editor);
      expect(md).toBe("before after\n");
      expect(warn).not.toHaveBeenCalled();
    }
  });
});
