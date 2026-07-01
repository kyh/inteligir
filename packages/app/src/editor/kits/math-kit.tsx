// Math kit — Base half (WP1). equation ↔ mdast `math` ($$ blocks),
// inline_equation ↔ mdast `inlineMath`. Single-dollar math is OFF (locked):
// inline math is `$$x$$`; a hand-typed `$x$` stays literal text. Node prop:
// texExpression. WP2 appends MathKit (KaTeX render) + insert transforms.

import { BaseEquationPlugin, BaseInlineEquationPlugin } from "@platejs/math";

export const MathBaseKit = [BaseEquationPlugin, BaseInlineEquationPlugin];
