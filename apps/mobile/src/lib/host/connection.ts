// ---------------------------------------------------------------------------
// The module-level connection singleton (mirrors ../sync/manager.ts): binds
// the pure owner in connection-core.ts to the real createWsBridge and React
// Native's AppState, and exposes the React hook. AppState mapping: `active`
// resumes; `background` suspends; iOS's transient `inactive` (control center,
// app switcher peek) is ignored — tearing the socket down there would churn
// reconnects for a state that usually bounces straight back to active.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";
import { AppState } from "react-native";

import { createWsBridge } from "@repo/features/ws-bridge";
import type { Bridge } from "@repo/features/ipc-registry";

import { createHostConnection, type HostSnapshot } from "./connection-core";
import type { KnownEnvironment } from "./environment-store";

const connection = createHostConnection({
  createBridge: (options) => createWsBridge(options),
  lifecycle: {
    subscribe: (listener) => {
      const subscription = AppState.addEventListener("change", (state) => {
        if (state === "active") listener("active");
        else if (state === "background") listener("background");
      });
      return () => {
        subscription.remove();
      };
    },
  },
});

/** Connect to a paired environment (replaces any current connection). */
export function startHostConnection(env: KnownEnvironment): void {
  connection.start(env);
}

/** Disconnect; status returns to `none`. */
export function stopHostConnection(): void {
  connection.stop();
}

/** The live Bridge to the desktop, or null when stopped / unauthorized.
 * Requests made while disconnected queue inside the bridge until reconnect. */
export function getHostBridge(): Bridge | null {
  return connection.getBridge();
}

/** Subscribe a React component to the connection status + environment name. */
export function useHostStatus(): HostSnapshot {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}
