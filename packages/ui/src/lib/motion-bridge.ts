// Bridge between Base UI's `render` prop (raw HTML props including DOM-only
// drag/animation handlers) and framer-motion's motion.* components, which
// type their own incompatible drag/animation event handlers. Stripping the
// conflicting handler keys lets the rest pass through cleanly.

import type { MotionStyle } from "motion/react";

import type { CSSPropertiesWithVars } from "@repo/ui/lib/css-vars";

type ConflictingKey =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

// `style` is omitted from the pass-through type as well: it's extracted at
// runtime, and motion's `style` prop wants MotionStyle (see toMotionStyle).
type StrippedHtmlProps<T extends HTMLElement> = Omit<
  React.HTMLAttributes<T>,
  ConflictingKey | "style"
>;

export type StripMotionResult<T extends HTMLElement> = {
  style: React.CSSProperties | undefined;
  rest: StrippedHtmlProps<T>;
};

export function stripMotionConflicts<T extends HTMLElement>(
  props: React.HTMLAttributes<T>,
): StripMotionResult<T> {
  const {
    style,
    onDrag: _onDrag,
    onDragStart: _onDragStart,
    onDragEnd: _onDragEnd,
    onAnimationStart: _onAnimationStart,
    onAnimationEnd: _onAnimationEnd,
    onAnimationIteration: _onAnimationIteration,
    ...rest
  } = props;
  return { style, rest };
}

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
