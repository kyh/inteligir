import { useRef, useSyncExternalStore } from "react";

const subscribedToNothing = () => null;

export const useLayoutReading = <T>(
  container: HTMLElement | null,
  initial: T,
  read: (container: HTMLElement, last: T) => T,
  marks?: string[],
) => {
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
