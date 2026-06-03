// Bridge between Base UI's `render` prop (raw HTML props including DOM-only
// drag/animation handlers) and framer-motion's motion.* components, which
// type their own incompatible drag/animation event handlers. Stripping the
// conflicting handler keys lets the rest pass through cleanly.

type ConflictingKey =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

export type StrippedHtmlProps<T extends HTMLElement> = Omit<
  React.HTMLAttributes<T>,
  ConflictingKey
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
