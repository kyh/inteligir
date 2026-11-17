import { useRef, useSyncExternalStore } from "react";

const subscribedToNothing = (): void => {
  // a list not in the document yet has nothing to stop watching
};

// What a list reads off its own laid-out rows, kept current. The layout is the store: the reading
// is taken in every render of the list, and again, before paint, when the list resizes or its rows
// change with no render of it. `read` hands `last` back as it is when nothing it reads has moved,
// which is what makes the reading a snapshot.
export const useLayoutReading = <T>(
  container: HTMLElement | null,
  // what a list out of the document reads as, so one value for the hook's life
  initial: T,
  read: (container: HTMLElement, last: T) => T,
  // attributes a row keeps its state in, so a row that changes one alone is read again
  marks?: string[],
): T => {
  const last = useRef(initial);

  const subscribe = (changed: () => void) => {
    if (container === null) {
      return subscribedToNothing;
    }
    const resized = new ResizeObserver(changed);
    resized.observe(container);
    const mutated = new MutationObserver(changed);
    mutated.observe(
      container,
      marks === undefined
        ? { childList: true, subtree: true }
        : { attributeFilter: marks, childList: true, subtree: true },
    );
    return () => {
      resized.disconnect();
      mutated.disconnect();
    };
  };

  return useSyncExternalStore(
    subscribe,
    () => {
      last.current = container === null ? initial : read(container, last.current);
      return last.current;
    },
    () => initial,
  );
};
