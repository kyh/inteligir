// Not @platejs/math's plugins: both its entrypoints import katex (JS + CSS) eagerly, ~280KB
// into the initial chunk through BASE_KIT. KaTeX loads lazily from nodes/equation-katex.tsx.

import { KEYS, createSlatePlugin } from "platejs";

export const EquationBasePlugin = createSlatePlugin({
  key: KEYS.equation,
  node: { isElement: true, isVoid: true },
});

export const InlineEquationBasePlugin = createSlatePlugin({
  key: KEYS.inlineEquation,
  node: { isElement: true, isInline: true, isVoid: true },
});

export const MathBaseKit = [EquationBasePlugin, InlineEquationBasePlugin];
