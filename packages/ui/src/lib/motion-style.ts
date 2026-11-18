import type { MotionStyle } from "motion/react";
import type { CSSProperties, HTMLAttributes } from "react";

type MotionStyleValue = Exclude<
  CSSProperties[keyof CSSProperties] | MotionStyle[keyof MotionStyle],
  undefined
>;

const styleEntries: (
  style: CSSProperties | MotionStyle,
) => [string, MotionStyleValue | undefined][] = Object.entries;

export const motionStyle = (...styles: (CSSProperties | MotionStyle | undefined)[]) => {
  const merged: Record<string, MotionStyleValue> = {};

  for (const style of styles) {
    if (!style) {
      continue;
    }

    for (const [key, value] of styleEntries(style)) {
      if (value !== undefined) {
        merged[key] = value;
      }
    }
  }

  return merged;
};

export type MotionConflictHandler =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

type DomHandlerProps = Pick<HTMLAttributes<HTMLElement>, MotionConflictHandler>;

export const motionProps = <P extends DomHandlerProps>(props: P) => {
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
};
