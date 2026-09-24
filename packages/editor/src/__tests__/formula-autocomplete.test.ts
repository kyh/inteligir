import { describe, expect, it } from "vitest";
import { ElementApi, createSlateEditor } from "platejs";
import type { TElement } from "platejs";

import { commitComboboxInput, consumeTriggerLead } from "@repo/editor/combobox-input";
import { FORMULA_INPUT_KEY } from "@repo/editor/formula-input-key";
import { completeFormulaFromPicker, insertFormulaFromPicker } from "@repo/editor/formula-insert";
import { formulaNodeFrom, rebuildRaw } from "@repo/editor/formulas/formula-entry";
import { EDITOR_KIT } from "@repo/editor/kits/editor-kit";
import { serializeNote } from "@repo/editor/markdown/markdown-doc";

const makeEditor = (text: string) =>
  createSlateEditor({
    plugins: EDITOR_KIT,
    value: [{ children: [{ text }], type: "p" }],
  });

type Editor = ReturnType<typeof makeEditor>;

const out = (editor: Editor): string => serializeNote(editor);

const findByType = (editor: Editor, type: string): TElement | null => {
  for (const [node] of editor.api.nodes({ at: [], match: { type } })) {
    if (ElementApi.isElement(node)) {
      return node;
    }
  }
  return null;
};

const openAndCommitFormulaPicker = (editor: Editor, offset: number): void => {
  editor.tf.select({ offset, path: [0, 0] });
  editor.tf.insertText("{");
  editor.tf.insertText("{");
  const element = findByType(editor, FORMULA_INPUT_KEY);
  if (!element) {
    throw new Error("{{ did not insert the formula input element");
  }
  commitComboboxInput(editor, element, false);
};

describe("formula picker completion", () => {
  it("completes a typed entry, consuming the literal {", () => {
    const editor = makeEditor("before after");
    openAndCommitFormulaPicker(editor, 7);
    completeFormulaFromPicker(editor, "2");
    expect(findByType(editor, "formulaPill")?.raw).toBe("2|2");
    expect(out(editor)).toBe("before {{2|2}}after\n");
  });

  it("completes a piped body verbatim", () => {
    const editor = makeEditor("before after");
    openAndCommitFormulaPicker(editor, 7);
    completeFormulaFromPicker(editor, "2+2|4");
    expect(out(editor)).toBe("before {{2+2|4}}after\n");
  });

  it("a picked variable replaces the whole {{", () => {
    const editor = makeEditor("before after");
    openAndCommitFormulaPicker(editor, 7);
    const meta = "id=abc;name=budget";
    insertFormulaFromPicker(
      editor,
      formulaNodeFrom({
        display: "5,000",
        meta,
        raw: rebuildRaw("5000", "5,000", meta),
        source: "5000",
      }),
    );
    expect(out(editor)).toBe("before {{5000|5,000|id=abc;name=budget}}after\n");
  });

  it("a body that is not a formula lands as the typed text, with one {{", () => {
    const editor = makeEditor("before after");
    openAndCommitFormulaPicker(editor, 7);
    completeFormulaFromPicker(editor, "hello world");
    expect(findByType(editor, "formulaPill")).toBeNull();
    expect(editor.api.string([0])).toBe("before {{hello world}}after");
  });

  it("keeps typing after completion in the text flow", () => {
    const editor = makeEditor("");
    openAndCommitFormulaPicker(editor, 0);
    completeFormulaFromPicker(editor, "2+2");
    editor.tf.insertText(" after");
    expect(out(editor)).toBe("{{2+2|4}} after\n");
  });
});

describe("consumeTriggerLead", () => {
  it("leaves the text alone when the character before the caret is not the lead", () => {
    const editor = makeEditor("before");
    editor.tf.select({ offset: 6, path: [0, 0] });
    expect(consumeTriggerLead(editor, "{")).toBe(false);
    expect(editor.api.string([0])).toBe("before");
  });

  it("answers false at the start of the document", () => {
    const editor = makeEditor("{");
    editor.tf.select({ offset: 0, path: [0, 0] });
    expect(consumeTriggerLead(editor, "{")).toBe(false);
    expect(editor.api.string([0])).toBe("{");
  });
});
