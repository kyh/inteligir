// The plugins are headless (headless/math-base.ts); KaTeX loads lazily from nodes/equation-katex.tsx.

import { KEYS } from "platejs";
import type { PlateEditor } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { EquationElement, InlineEquationElement } from "@repo/editor/nodes/equation-node";

import { EquationBasePlugin, InlineEquationBasePlugin } from "./headless/math-base";

export const insertEquation = (editor: PlateEditor): void => {
  insertVoidAndEscape(editor, {
    children: [{ text: "" }],
    texExpression: "",
    type: editor.getType(KEYS.equation),
  });
};

export const insertInlineEquation = (editor: PlateEditor): void => {
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
