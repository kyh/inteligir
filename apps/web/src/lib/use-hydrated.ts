import { useSyncExternalStore } from "react";

const subscribe = () => () => null;

export const useHydrated = () =>
  useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
