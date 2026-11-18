import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { EquationElement, InlineEquationElement } from "@repo/editor/nodes/equation-node";

import { EquationBasePlugin, InlineEquationBasePlugin } from "@repo/editor/headless/kits/math-base";

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

export const MathKit = [
  EquationBasePlugin.withComponent(EquationElement),
  InlineEquationBasePlugin.withComponent(InlineEquationElement),
];
