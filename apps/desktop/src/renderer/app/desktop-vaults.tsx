// The vault is the server's, so main switches it: the child restarts on the new folder and a
// new window replaces this one. A browser tab did not start the server: no bridge, no row.

import { useState } from "react";
import type { DesktopVaultsBridge } from "../../types";
import type { VaultRef, VaultSwitchAnswer, VaultsState } from "../../vaults-state";
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

const vaultsBridge = (): DesktopVaultsBridge | undefined => window.desktopBridge?.vaults;

const store = createBridgeStore<DesktopVaultsBridge, VaultsState>({
  bridge: vaultsBridge,
  start: (vaults, adopt) => {
    void adoptInitial(vaults, adopt);
  },
});

export const useDesktopVaults = store.use;

// main's refusal, in main's words, or null once the answer is adopted
type VaultRefusal = string | null;

const settleAnswer = async (
  ask: (vaults: DesktopVaultsBridge) => Promise<VaultSwitchAnswer>,
): Promise<VaultRefusal> => {
  const vaults = vaultsBridge();
  if (vaults === undefined) {
    return null;
  }
  const answer = await ask(vaults);
  if (!answer.ok) {
    return answer.reason;
  }
  store.adopt(answer.state);
  return null;
};

// each answers only when nothing moved: a cancelled picker, a forgotten row, or a refusal;
// a switch replaces the window before any answer could land
export const pickVault = async (): Promise<VaultRefusal> =>
  await settleAnswer(async (vaults) => await vaults.pick());

export const openRecentVault = async (path: string): Promise<VaultRefusal> =>
  await settleAnswer(async (vaults) => await vaults.open(path));

// a row is forgotten whatever the list held, so there is nothing to refuse
export const forgetRecentVault = async (path: string): Promise<null> => {
  await store.run(async (vaults) => await vaults.forget(path));
  return null;
};

type VaultSwitchBusy = "picking" | "opening" | "forgetting";

export interface VaultSwitch {
  busy: VaultSwitchBusy | null;
  // the busy kind is what a surface shows while it waits; a refusal is toasted in main's words
  run: (kind: VaultSwitchBusy, work: () => Promise<VaultRefusal>) => void;
}

// a throw across the bridge is a fault, worded by Electron, so it gets this sentence instead
const settleSwitch = async (
  work: () => Promise<VaultRefusal>,
  onRefused: (message: string) => void,
  onSettled: () => void,
): Promise<void> => {
  try {
    const refusal = await work();
    if (refusal !== null) {
      onRefused(refusal);
    }
  } catch (error) {
    console.warn("[vaults] the shell did not answer", error);
    onRefused("Could not open that vault.");
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
    <span className="truncate text-subtitle">{vault.name}</span>
    <span className="truncate font-mono text-caption text-muted-foreground">{vault.path}</span>
  </span>
);
