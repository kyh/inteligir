import type { DesktopBridge } from "@repo/core/ipc";

/** The transport-agnostic host interface the UI talks to. Named `Bridge`
 * because it is no longer Electron-specific: the Electron shell provides it
 * over IPC, and (in a later phase) a web server provides it over WebSocket.
 * The shape is still derived from the one IPC registry, so this is an alias. */
export type Bridge = DesktopBridge;

// The host installs its Bridge once at startup via setBridge; UI code reads it
// through getBridge. A module singleton (rather than React context) so that
// non-React callers — zustand stores, state machines — can reach it too.
let injected: Bridge | null = null;

/** Install the host's Bridge. Called once by the host entry before render. */
export function setBridge(bridge: Bridge): void {
  injected = bridge;
}

/** Access the host-injected bridge. Null until the host calls setBridge. */
export function getBridge(): Bridge | null {
  return injected;
}
