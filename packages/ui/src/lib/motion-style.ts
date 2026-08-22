// framer-motion's MotionStyle spells its optional properties without
// `| undefined`, so under exactOptionalPropertyTypes React's CSSProperties
// (whose optionals all carry it) can never be spread into a motion `style` —
// even though the runtime meaning is identical, since motion, like React,
// skips undefined entries. So the merge lives here, mirroring lib/css-vars.ts:
// combine plain CSS with motion values, dropping undefined entries so the
// returned object honestly fits MotionStyle's spelling.

import type { MotionStyle } from "framer-motion";
import type { CSSProperties } from "react";

type MotionStyleValue = Exclude<
  CSSProperties[keyof CSSProperties] | MotionStyle[keyof MotionStyle],
  undefined
>;

export function motionStyle(...styles: (CSSProperties | MotionStyle | undefined)[]): MotionStyle {
  const merged: Record<string, MotionStyleValue> = {};
  for (const style of styles) {
    if (!style) continue;
    for (const [key, value] of Object.entries(style)) {
      if (value !== undefined) merged[key] = value;
    }
  }
  return merged;
}
