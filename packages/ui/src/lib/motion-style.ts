import type { CSSProperties } from "react";
import type { MotionStyle } from "framer-motion";

/**
 * Bridge a plain `CSSProperties` (typically a Base UI render-prop `style`) into
 * framer-motion's `MotionStyle`.
 *
 * csstype declares every CSS property as `T | undefined` *explicitly*, while
 * framer-motion's `MotionStyle` declares them exact-optional (no `| undefined`).
 * Under `exactOptionalPropertyTypes` that makes a direct `CSSProperties →
 * MotionStyle` assignment fail even though the runtime objects are identical.
 * This is the single sanctioned seam for that third-party bridge — spread its
 * result and add animated props (`x`, `y`, …) at the call site.
 */
export function toMotionStyle(style: CSSProperties | undefined): MotionStyle {
  // eslint-disable-next-line typescript/consistent-type-assertions -- framer-motion MotionStyle (exact-optional) vs csstype CSSProperties (explicit `| undefined`) under exactOptionalPropertyTypes; runtime-identical object
  return (style ?? {}) as MotionStyle;
}
