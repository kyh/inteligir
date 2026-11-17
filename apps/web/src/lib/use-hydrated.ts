import { useSyncExternalStore } from "react";

// hydration happens once, so nothing ever changes to listen for
const subscribe = () => () => {
  // no listener was added
};

// false in the server's render and in hydration, true once React runs in the browser
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
