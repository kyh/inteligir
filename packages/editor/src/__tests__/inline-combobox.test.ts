import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ElementApi, KEYS, createSlateEditor, type TElement } from "platejs";
import { serializeMd } from "@platejs/markdown";

import {
  absorbRacedComboboxText,
  cancelComboboxInput,
  commitComboboxInput,
  racedComboboxText,
  reconcileInsertionCaret,
} from "@repo/editor/combobox-input";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { MD_STRINGIFY } from "@repo/editor/markdown/markdown-doc";

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
    expect(out(editor)).toBe("hello :tada\n");
  });

  it("cancel after an undo removed the element is a strict no-op", () => {
    const editor = makeEditor("hello ");
    const element = openCombobox(editor, ":", KEYS.emojiInput);
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
    const path = editor.api.findPath(element);
    if (!path) throw new Error("element path missing");
    editor.tf.select({ offset: 0, path: [...path, 0] });
    editor.tf.insertText("t", { voids: true });
    const raced = findByType(editor, KEYS.emojiInput);
    expect(raced ? racedComboboxText(raced) : "").toBe("t");
    if (!raced) throw new Error("element missing");
    expect(absorbRacedComboboxText(editor, raced)).toBe("t");
    const cleared = findByType(editor, KEYS.emojiInput);
    expect(cleared ? racedComboboxText(cleared) : "?").toBe("");
    if (!cleared) throw new Error("element missing");
    cancelComboboxInput(editor, cleared, { cause: "escape", restoreText: ":tada" });
    expect(out(editor)).toBe(":tada\n");
    expect(() => {
      for (let i = 0; i < 10; i++) editor.undo();
      for (let i = 0; i < 10; i++) editor.redo();
    }).not.toThrow();
    expect(out(editor)).toBe(":tada\n");
  });
});

describe("reconcileInsertionCaret (the first-commit caret quirk)", () => {
  it("moves a caret stranded before the first typed char", () => {
    expect(reconcileInsertionCaret("", "d", 0)).toBe(1);
    expect(reconcileInsertionCaret("", "t", 0)).toBe(1);
  });

  it("assembles 'deep' and 'tada' across the exact first-char sequence", () => {
    for (const word of ["deep", "tada"]) {
      let value = "";
      let caret = 0;
      for (const [i, char] of Array.from(word).entries()) {
        const next = value.slice(0, caret) + char + value.slice(caret);
        const reported = i === 0 ? caret : caret + 1;
        caret = reconcileInsertionCaret(value, next, reported) ?? reported;
        value = next;
      }
      expect(value).toBe(word);
      expect(caret).toBe(word.length);
    }
  });

  it("moves a stranded caret for multi-char and mid-string commits", () => {
    expect(reconcileInsertionCaret("", "deep", 0)).toBe(4);
    expect(reconcileInsertionCaret("ab", "aXb", 1)).toBe(2);
  });

  it("never fights a consistent native caret", () => {
    expect(reconcileInsertionCaret("", "d", 1)).toBeNull();
    expect(reconcileInsertionCaret("de", "dee", 3)).toBeNull();
    expect(reconcileInsertionCaret("ab", "aXb", 2)).toBeNull();
  });

  it("repeated characters read both ways — trust the browser", () => {
    expect(reconcileInsertionCaret("aa", "aaa", 1)).toBeNull();
    expect(reconcileInsertionCaret("aa", "aaa", 2)).toBeNull();
  });

  it("ignores deletions, replacements, and missing carets", () => {
    expect(reconcileInsertionCaret("de", "d", 1)).toBeNull();
    expect(reconcileInsertionCaret("abc", "aXbYc", 1)).toBeNull();
    expect(reconcileInsertionCaret("", "d", null)).toBeNull();
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
