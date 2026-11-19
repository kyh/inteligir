import type { SlateEditor } from "platejs";

import { consumeTriggerLead } from "@repo/editor/headless/combobox-input";
import { pillFromEntryIn, pillNode } from "@repo/editor/formulas/formula-entry";
import { insertVoidAndEscape } from "@repo/editor/insert-void";

export const completeFormulaFromPicker = (editor: SlateEditor, entry: string) => {
  const pill = pillFromEntryIn(editor, entry);
  consumeTriggerLead(editor, "{");

  if (pill === null) {
    editor.tf.insertText(`{{${entry}}}`);

    return;
  }

  insertVoidAndEscape(editor, pillNode(pill));
};
