// ---------------------------------------------------------------------------
// The module-level connection singleton: binds
// the pure owner in connection-core.ts to the real createWsBridge, the shared
// app-foreground seam (../app-lifecycle.ts — `active` resumes, `background`
// suspends) and the platform clock/timer, and exposes the React hook.
// ---------------------------------------------------------------------------

import { useSyncExternalStore } from "react";

import { timeoutSchedule } from "@repo/bridge/backoff";
import { createWsBridge } from "@repo/bridge/ws-bridge";
import type { Bridge } from "@repo/bridge/ipc-registry";

import { subscribeAppForeground } from "../app-lifecycle";
import { createHostConnection, type HostSnapshot } from "./connection-core";
import type { KnownEnvironment } from "./environment-store";

const connection = createHostConnection({
  createBridge: (options) => createWsBridge(options),
  lifecycle: { subscribe: subscribeAppForeground },
  now: () => Date.now(),
  schedule: timeoutSchedule,
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

/** The current status + environment name, outside React (the chat outbox
 * drains off it). */
export function getHostSnapshot(): HostSnapshot {
  return connection.getSnapshot();
}

/** Subscribe to connection changes outside React (the chat outbox). */
export function subscribeHostStatus(onChange: () => void): () => void {
  return connection.subscribe(onChange);
}

/** Subscribe a React component to the connection status + environment name. */
export function useHostStatus(): HostSnapshot {
  return useSyncExternalStore(connection.subscribe, connection.getSnapshot);
}
