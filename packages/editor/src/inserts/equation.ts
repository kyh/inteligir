import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";

export const insertEquation = (editor: PlateEditor) => {
  insertVoidAndEscape(editor, {
    children: [{ text: "" }],
    texExpression: "",
    type: editor.getType(KEYS.equation),
  });
};

export const insertInlineEquation = (editor: PlateEditor) => {
  const seed = editor.selection ? editor.api.string(editor.selection) : "";
  insertVoidAndEscape(editor, {
    children: [{ text: "" }],
    texExpression: seed,
    type: editor.getType(KEYS.inlineEquation),
  });
};
