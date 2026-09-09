// MotionStyle spells its optionals without `| undefined`, so under exactOptionalPropertyTypes
// React's CSSProperties cannot be spread into a motion style; dropping undefined entries makes
// the merge fit

import type { MotionStyle } from "framer-motion";
import type { CSSProperties, HTMLAttributes } from "react";

type MotionStyleValue = Exclude<
  CSSProperties[keyof CSSProperties] | MotionStyle[keyof MotionStyle],
  undefined
>;

// CSSProperties and MotionStyle are interfaces, so neither satisfies the indexed overload of
// Object.entries; naming the entry type here is what keeps the merge loop off `any`
const styleEntries: (
  style: CSSProperties | MotionStyle,
) => [string, MotionStyleValue | undefined][] = Object.entries;

export const motionStyle = (
  ...styles: (CSSProperties | MotionStyle | undefined)[]
): MotionStyle => {
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

// the DOM handlers framer redefines with its own signatures
export type MotionConflictHandler =
  | "onDrag"
  | "onDragStart"
  | "onDragEnd"
  | "onAnimationStart"
  | "onAnimationEnd"
  | "onAnimationIteration";

type DomHandlerProps = Pick<HTMLAttributes<HTMLElement>, MotionConflictHandler>;

export const motionProps = <P extends DomHandlerProps>(
  props: P,
): Omit<P, MotionConflictHandler> => {
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
