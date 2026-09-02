import type { Ref, RefCallback } from "react";

// with a single ref this is also the adapter that lets a forwarded Ref<HTMLElement> reach a
// <button> or a <div>: RefObject is invariant in its element type, RefCallback is not
export function composeRefs<T>(...refs: (Ref<T> | undefined)[]): RefCallback<T> {
  return (node) => {
    for (const ref of refs) {
      if (ref == null) continue;
      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React's Ref union carries no discriminant; a callback ref is only distinguishable from a ref object by its representation, and this helper is the single place that asks.
      if (typeof ref === "function") ref(node);
      else ref.current = node;
    }
  };
}
