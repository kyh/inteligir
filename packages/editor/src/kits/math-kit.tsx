// Not @platejs/math's plugins: both its entrypoints import katex (JS + CSS) eagerly, ~280KB
// into the initial chunk through BASE_KIT. KaTeX loads lazily from nodes/equation-katex.tsx.

import { KEYS, createSlatePlugin } from "platejs";
import type { PlateEditor } from "platejs/react";

import { insertVoidAndEscape } from "@repo/editor/insert-void";
import { EquationElement, InlineEquationElement } from "@repo/editor/nodes/equation-node";

const EquationBasePlugin = createSlatePlugin({
  key: KEYS.equation,
  node: { isElement: true, isVoid: true },
});

const InlineEquationBasePlugin = createSlatePlugin({
  key: KEYS.inlineEquation,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const MathBaseKit = [EquationBasePlugin, InlineEquationBasePlugin];

export function insertEquation(editor: PlateEditor): void {
  insertVoidAndEscape(editor, {
    children: [{ text: "" }],
    texExpression: "",
    type: editor.getType(KEYS.equation),
  });
}

export function insertInlineEquation(editor: PlateEditor): void {
  const seed = editor.selection ? editor.api.string(editor.selection) : "";
  insertVoidAndEscape(editor, {
    children: [{ text: "" }],
    texExpression: seed,
    type: editor.getType(KEYS.inlineEquation),
  });
}

export const MathKit = [
  EquationBasePlugin.withComponent(EquationElement),
  InlineEquationBasePlugin.withComponent(InlineEquationElement),
];
