import type { Bridge } from "@repo/features/ipc-registry";

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

/** Does a vault doc exist at `path`? A read that resolves means yes; any
 * rejection (absent, unreadable) means no — the caller only wants the
 * boolean, never the bytes or the error. */
export async function docExists(
  bridge: { readVaultDoc(payload: { path: string }): Promise<string> },
  path: string,
): Promise<boolean> {
  try {
    await bridge.readVaultDoc({ path });
    return true;
  } catch {
    return false;
  }
}
