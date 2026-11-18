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
