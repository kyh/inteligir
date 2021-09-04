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
