import type { MotionStyle } from "framer-motion";

import type { CSSPropertiesWithVars } from "@repo/ui/lib/css-vars";

/**
 * Single documented bridge for an upstream types gap: motion's `MotionStyle`
 * re-maps React.CSSProperties' optional props without `| undefined` (motion
 * isn't compiled with exactOptionalPropertyTypes), so a plain CSSProperties
 * object is rejected under that flag. Every motion.* `style` prop in this
 * package funnels CSS through here instead of casting inline.
 */
export function toMotionStyle(
  style: React.CSSProperties | CSSPropertiesWithVars | undefined,
): MotionStyle {
  // oxlint-disable-next-line typescript/consistent-type-assertions -- upstream MotionStyle gap, see doc above
  return (style ?? {}) as MotionStyle;
}
