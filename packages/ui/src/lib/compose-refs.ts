import type { Ref, RefCallback } from "react";

export const composeRefs = <T>(...refs: (Ref<T> | undefined)[]) =>
  ((node) => {
    for (const ref of refs) {
      if (ref === null || ref === undefined) {
        continue;
      }

      // oxlint-disable-next-line anti-slop/no-runtime-typeof -- React's Ref union carries no discriminant; a callback ref is only distinguishable from a ref object by its representation, and this helper is the single place that asks.
      if (typeof ref === "function") {
        ref(node);
      } else {
        ref.current = node;
      }
    }
  }) satisfies RefCallback<T>;
