import type { Bridge } from "@repo/core/ipc";

// Module-level slot, filled once by the host entry (Electron preload bridge,
// dev-harness fixture, later a WS client) before the first render — the app
// never reaches for a transport itself.
let installed: Bridge | null = null;

/** Install the host's bridge. Called exactly once at boot, before render. */
export function installBridge(bridge: Bridge): void {
  installed = bridge;
}

/** Access the installed bridge. Null only if the host never installed one. */
export function getBridge(): Bridge | null {
  return installed;
}
