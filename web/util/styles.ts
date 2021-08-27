import {
  createElement,
  forwardRef,
  ReactNode,
  ReactHTML,
  AllHTMLAttributes,
} from "react";

/**
 * Dynamically filter classNames
 *
 * Usage example:
 *
 * <button
 *   className={cx(
 *     "this is always applied",
 *     isTruthy && "this only when the isTruthy is truthy",
 *     active ? "active classes" : "inactive classes"
 *   )}
 * >
 *   Text
 * </button>;
 **/
export const cx = (...classes: (false | null | undefined | string)[]) => {
  return classes.filter(Boolean).join(" ");
};

/**
 * React element factory with base tailwind styles
 *
 * Usage example:
 *
 * const Text = tw("p", "text-base text-gray-800");
 *
 * <Text>Hello</Text>;
 * <Text as="span">Hello</Text>;
 * <Text className="mb-4">Hello</Text>;
 **/
export const tw = (tag: Tag, baseClassName: string) => {
  const Component = forwardRef<Ref, ComponentProps>(
    ({ as = tag, className = "", children, ...rest }, ref) => {
      const cxn = cx(baseClassName, className);
      return createElement(as, { ref, className: cxn, ...rest }, children);
    }
  );

  Component.displayName = `tw(${tag})`;

  return Component;
};

export type ComponentProps = AllHTMLAttributes<HTMLOrSVGElement> & {
  children?: ReactNode;
  as?: Tag;
  className?: string;
};

export type Ref = ReactNode | HTMLElement | string;
export type Tag = keyof ReactHTML;
export type Modify<T, R> = Omit<T, keyof R> & R;
