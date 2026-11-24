import { EquationElement, InlineEquationElement } from "@repo/editor/nodes/equation-node";

import { EquationBasePlugin, InlineEquationBasePlugin } from "@repo/editor/headless/kits/math-base";

export const MathKit = [
  EquationBasePlugin.withComponent(EquationElement),
  InlineEquationBasePlugin.withComponent(InlineEquationElement),
];
