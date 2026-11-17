import { useSyncExternalStore } from "react";

// nothing to listen to: hydration happens once, and React calls what this answers on unmount
const unsubscribe = (): void => {
  // nothing was subscribed
};
const subscribe = () => unsubscribe;

// false on the server and through hydration, true from the first render after it: what the
// server's HTML could not know (a stored theme) waits until then
export const useHydrated = (): boolean =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
