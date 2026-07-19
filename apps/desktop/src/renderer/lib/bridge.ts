import type { Bridge } from "@repo/bridge/ipc-registry";

// Module-level slot, filled once by the host entry (the desktop's ws bridge,
// or the dev-harness fixture) before the first render — the app never
// reaches for a transport itself.
let installed: Bridge | null = null;

/** Install the host's bridge. Called exactly once at boot, before render. */
export function installBridge(bridge: Bridge): void {
  installed = bridge;
}

/** Access the installed bridge. Both entry points install the bridge before
 * the first render, so any null here is a boot-order bug — throw loudly
 * instead of making every call site carry a dead guard. */
export function getBridge(): Bridge {
  if (installed === null) {
    throw new Error("getBridge() before installBridge — boot-order bug");
  }
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
