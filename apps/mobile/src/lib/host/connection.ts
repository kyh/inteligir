// ---------------------------------------------------------------------------
// The module-level connection singleton (mirrors ../sync/manager.ts): binds
// the pure owner in connection-core.ts to the real createWsBridge and the
// shared app-foreground seam (../app-lifecycle.ts — `active` resumes,
// `background` suspends), and exposes the React hook.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { createWsBridge } from "@repo/features/ws-bridge";
import type { Bridge } from "@repo/features/ipc-registry";

import { subscribeAppForeground } from "../app-lifecycle";
import { createHostConnection, type HostSnapshot } from "./connection-core";
import type { KnownEnvironment } from "./environment-store";

const connection = createHostConnection({
  createBridge: (options) => createWsBridge(options),
  lifecycle: { subscribe: subscribeAppForeground },
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
