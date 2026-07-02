// Math kit. equation ↔ mdast `math` ($$ blocks), inline_equation ↔ mdast
// `inlineMath`. Single-dollar math is OFF (locked): inline math is `$$x$$`;
// a hand-typed `$x$` stays literal text. Node prop: texExpression.
//
// The plugins are OWNED here instead of using @platejs/math's: both its base
// and react entrypoints import katex (JS + CSS) eagerly at module top, which
// would chain ~280KB of renderer into the initial chunk through BASE_KIT.
// The plugin definitions are metadata-only (keys + isElement/isVoid/isInline
// — identical to @platejs/math's, pinned by kit-parity); KaTeX loads in an
// async chunk from the node component (nodes/equation-katex.tsx). The
// `equation`/`inline_equation` markdown rules live in @platejs/markdown's
// defaults and are unaffected.

import { KEYS, createSlatePlugin } from "platejs";
import type { PlateEditor } from "platejs/react";

import { EquationElement, InlineEquationElement } from "@repo/app/editor/nodes/equation-node";

const EquationBasePlugin = createSlatePlugin({
  key: KEYS.equation,
  node: { isElement: true, isVoid: true },
});

const InlineEquationBasePlugin = createSlatePlugin({
  key: KEYS.inlineEquation,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const MathBaseKit = [EquationBasePlugin, InlineEquationBasePlugin];

/** Insert an empty display equation ($$ block); the popover opens on click. */
export function insertEquation(editor: PlateEditor): void {
  editor.tf.insertNodes(
    { children: [{ text: "" }], texExpression: "", type: editor.getType(KEYS.equation) },
    { select: true },
  );
}

/** Insert an inline equation ($$x$$), seeding it with the selected text. */
export function insertInlineEquation(editor: PlateEditor): void {
  const seed = editor.selection ? editor.api.string(editor.selection) : "";
  editor.tf.insertNodes(
    { children: [{ text: "" }], texExpression: seed, type: editor.getType(KEYS.inlineEquation) },
    { select: true },
  );
}

export const MathKit = [
  EquationBasePlugin.withComponent(EquationElement),
  InlineEquationBasePlugin.withComponent(InlineEquationElement),
];
