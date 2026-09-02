// framer-motion's MotionStyle spells its optional properties without
// `| undefined`, so under exactOptionalPropertyTypes React's CSSProperties
// (whose optionals all carry it) can never be spread into a motion `style` —
// even though the runtime meaning is identical, since motion, like React,
// skips undefined entries. So the merge lives here, mirroring lib/css-vars.ts:
// combine plain CSS with motion values, dropping undefined entries so the
// returned object honestly fits MotionStyle's spelling.

import type { MotionStyle } from "framer-motion";
import type { CSSProperties, HTMLAttributes } from "react";

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

/** The DOM handlers framer's motion elements redefine with their own
 *  signatures. A component that renders a motion element omits these from its
 *  public props and strips them from what it spreads in. */
export type MotionConflictHandler =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

type DomHandlerProps = Pick<HTMLAttributes<HTMLElement>, MotionConflictHandler>;

/** A primitive's render props with the DOM-typed drag/animation handlers
 *  dropped, so the rest spreads into a motion element without a cast. */
export function motionProps<P extends DomHandlerProps>(props: P): Omit<P, MotionConflictHandler> {
  const {
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...rest
  } = props;
  return rest;
}
