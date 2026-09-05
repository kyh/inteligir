// The vault is the server's, so main switches it: the child restarts on the new folder and a
// new window replaces this one. A browser tab did not start the server: no bridge, no row.

import type { DesktopVaultsBridge } from "../../types";
import type { VaultsState } from "../../vaults-state";
import { createBridgeStore } from "./bridge-store";

const store = createBridgeStore<DesktopVaultsBridge, VaultsState>({
  bridge: () => window.desktopBridge?.vaults,
  start: (vaults, adopt) => {
    vaults.getState().then(adopt, (cause: unknown) => {
      console.warn("[vaults] the shell did not answer", cause);
    });
  },
});

export const useDesktopVaults = store.use;

// each answers only when nothing moved: a cancelled picker, a forgotten row, or a refusal
// thrown; a switch replaces the window before any answer could land
export function pickVault(): Promise<void> {
  return store.run((vaults) => vaults.pick());
}

export function openRecentVault(path: string): Promise<void> {
  return store.run((vaults) => vaults.open(path));
}

export function forgetRecentVault(path: string): Promise<void> {
  return store.run((vaults) => vaults.forget(path));
}
