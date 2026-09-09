// The vault is the server's, so main switches it: the child restarts on the new folder and a
// new window replaces this one. A browser tab did not start the server: no bridge, no row.

import { useState } from "react";
import type { DesktopVaultsBridge } from "../../types";
import type { VaultRef, VaultsState } from "../../vaults-state";
import { refusalMessage } from "./api";
import { createBridgeStore } from "./bridge-store";

const adoptInitial = async (
  vaults: DesktopVaultsBridge,
  adopt: (state: VaultsState) => void,
): Promise<void> => {
  let state;
  try {
    state = await vaults.getState();
  } catch (error) {
    console.warn("[vaults] the shell did not answer", error);
    return;
  }
  adopt(state);
};

const store = createBridgeStore<DesktopVaultsBridge, VaultsState>({
  bridge: () => window.desktopBridge?.vaults,
  start: (vaults, adopt) => {
    void adoptInitial(vaults, adopt);
  },
});

export const useDesktopVaults = store.use;

// each answers only when nothing moved: a cancelled picker, a forgotten row, or a refusal
// thrown; a switch replaces the window before any answer could land
export const pickVault = async (): Promise<void> => {
  await store.run(async (vaults) => await vaults.pick());
};

export const openRecentVault = async (path: string): Promise<void> => {
  await store.run(async (vaults) => await vaults.open(path));
};

export const forgetRecentVault = async (path: string): Promise<void> => {
  await store.run(async (vaults) => await vaults.forget(path));
};

type VaultSwitchBusy = "picking" | "opening" | "forgetting";

export interface VaultSwitch {
  busy: VaultSwitchBusy | null;
  // the busy kind is what a surface shows while it waits; a refusal is toasted in main's words
  run: (kind: VaultSwitchBusy, work: () => Promise<void>) => void;
}

const settleSwitch = async (
  work: () => Promise<void>,
  onRefused: (message: string) => void,
  onSettled: () => void,
): Promise<void> => {
  try {
    await work();
  } catch (error) {
    onRefused(refusalMessage(error, "Could not open that vault."));
  } finally {
    onSettled();
  }
};

// one busy-and-refusal policy for every surface that switches vaults
export const useVaultSwitch = (onRefused: (message: string) => void): VaultSwitch => {
  const [busy, setBusy] = useState<VaultSwitchBusy | null>(null);
  return {
    busy,
    run: (kind, work) => {
      setBusy(kind);
      void settleSwitch(work, onRefused, () => {
        setBusy(null);
      });
    },
  };
};

// a remembered vault's name over its path, the same in the rail's menu and in Settings
export const RecentVaultLabel = ({ vault }: { vault: VaultRef }) => (
  <span className="flex min-w-0 flex-col">
    <span className="truncate text-sm">{vault.name}</span>
    <span className="truncate font-mono text-[11px] text-muted-foreground">{vault.path}</span>
  </span>
);
