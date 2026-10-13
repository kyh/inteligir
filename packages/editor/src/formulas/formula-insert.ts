import type { SlateEditor, TElement } from "platejs";

import { consumeTriggerLead } from "@repo/editor/combobox-input";
import { formulaNodeFromTyped } from "@repo/editor/formulas/formula-entry";
import { insertVoidAndEscape } from "@repo/editor/insert-void";

export const insertFormulaFromPicker = (editor: SlateEditor, pill: TElement): void => {
  consumeTriggerLead(editor, "{");
  insertVoidAndEscape(editor, pill);
};

// A body that is not a formula lands as the text that was typed, as it does outside the picker.
export const completeFormulaFromPicker = (editor: SlateEditor, entry: string): void => {
  const pill = formulaNodeFromTyped(entry);
  if (pill !== null) {
    insertFormulaFromPicker(editor, pill);
    return;
  }
  consumeTriggerLead(editor, "{");
  editor.tf.insertText(`{{${entry}}}`);
};
