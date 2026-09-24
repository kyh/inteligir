// once the server stops accepting this page's credential it refuses every call 401: a restarted
// server holds a new cookie secret, and an adopted server someone restarted a new bearer. read off
// the transport, one flag stands in for the refusal each call would otherwise raise, and the next
// answer clears it, so a browser signed in again from another tab recovers without a reload.

import { useSyncExternalStore } from "react";

let signedOut = false;
const listeners = new Set<() => void>();

export const observeGateRefusal = (refused: boolean): void => {
  if (refused === signedOut) {
    return;
  }
  signedOut = refused;
  for (const listener of listeners) {
    listener();
  }
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

const getSnapshot = (): boolean => signedOut;

export const useSignedOut = (): boolean => useSyncExternalStore(subscribe, getSnapshot);
