import type { Ref, RefCallback } from "react";

/** `Ref` is a union of a callback and a mutable box, and a part keeps its own
 *  handle on a node while still honouring the forwarded one — so both shapes
 *  have to be written to. This is the ONE place a ref's shape is
 *  discriminated; components compose rather than re-spelling the check.
 *
 *  Called with a single ref it is also the adapter that lets a forwarded
 *  `Ref<HTMLElement>` reach a `<button>` or a `<div>`: React's RefObject is
 *  invariant in its element type and its RefCallback is not, so a component
 *  whose branches render different elements forwards through a callback. */
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
