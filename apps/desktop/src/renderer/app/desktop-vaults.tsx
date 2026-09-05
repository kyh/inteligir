// The vault is the server's, so main switches it: the child restarts on the new folder and a
// new window replaces this one. A browser tab did not start the server: no bridge, no row.

import { useState } from "react";
import type { DesktopVaultsBridge } from "../../types";
import type { VaultRef, VaultsState } from "../../vaults-state";
import { refusalMessage } from "./api";
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

type VaultSwitchBusy = "picking" | "opening" | "forgetting";

export interface VaultSwitch {
  busy: VaultSwitchBusy | null;
  // the busy kind is what a surface shows while it waits; a refusal is toasted in main's words
  run: (kind: VaultSwitchBusy, work: () => Promise<void>) => void;
}

// one busy-and-refusal policy for every surface that switches vaults
export function useVaultSwitch(onRefused: (message: string) => void): VaultSwitch {
  const [busy, setBusy] = useState<VaultSwitchBusy | null>(null);
  return {
    busy,
    run: (kind, work) => {
      setBusy(kind);
      void work()
        .catch((cause: unknown) => {
          onRefused(refusalMessage(cause, "Could not open that vault."));
        })
        .finally(() => {
          setBusy(null);
        });
    },
  };
}

// a remembered vault's name over its path, the same in the rail's menu and in Settings
export function RecentVaultLabel({ vault }: { vault: VaultRef }) {
  return (
    <span className="flex min-w-0 flex-col">
      <span className="truncate text-sm">{vault.name}</span>
      <span className="truncate font-mono text-[11px] text-muted-foreground">{vault.path}</span>
    </span>
  );
}
