import type { SlateEditor } from "platejs";

import { consumeTriggerLead } from "@repo/editor/headless/combobox-input";
import { pillFromEntryIn, pillNode } from "@repo/editor/formulas/formula-entry";
import { insertVoidAndEscape } from "@repo/editor/insert-void";

// The picker's body as the pill it spells, the `{` before its trigger taken with it. A body that
// spells none lands as the text that was typed, as it does outside the picker.
export const completeFormulaFromPicker = (editor: SlateEditor, entry: string): void => {
  const pill = pillFromEntryIn(editor, entry);
  consumeTriggerLead(editor, "{");
  if (pill === null) {
    editor.tf.insertText(`{{${entry}}}`);
    return;
  }
  insertVoidAndEscape(editor, pillNode(pill));
};
