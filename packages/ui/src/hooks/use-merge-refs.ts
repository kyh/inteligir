import { useCallback, type Ref, type RefCallback } from "react";

/**
 * Merge two or more refs into a single callback ref that fans the assignment
 * out to each input. Handles function refs and object refs uniformly; safe
 * for nulls. Centralizes the boilerplate that Base UI's `render` prop forces
 * (the renderer hands you its own ref and you usually have your own + a
 * forwarded one).
 */
export function useMergeRefs<T>(...refs: Array<Ref<T> | undefined | null>): RefCallback<T> {
  return useCallback(
    (node: T | null) => {
      for (const ref of refs) {
        if (!ref) continue;
        if (typeof ref === "function") {
          ref(node);
        } else {
          // React 19's RefObject<T>.current is writable; assigning here is the
          // documented merge pattern.
          ref.current = node;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs spread is stable per render
    refs,
  );
}
