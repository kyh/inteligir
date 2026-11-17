import { useSyncExternalStore } from "react";

// hydration happens once, so nothing ever changes to listen for
const subscribe = () => () => {
  // no listener was added
};

// false on the server and through hydration, true from the first render after it
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
