// The vault is the server's, so main switches it: the child restarts on the new folder and a
// new window replaces this one. The page mirrors main's answer off the bridge; outside the
// shell there is no bridge and no row, since a browser tab did not start the server.

import { useSyncExternalStore } from "react";
import type { DesktopVaultsBridge } from "../../types";
import type { VaultsState } from "../../vaults-state";

export type VaultsSnapshot =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: VaultsState };

const listeners = new Set<() => void>();
let snapshot: VaultsSnapshot = { kind: "loading" };
let started = false;

function bridge(): DesktopVaultsBridge | undefined {
  return window.desktopBridge?.vaults;
}

function publish(next: VaultsSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function adopt(state: VaultsState): void {
  publish({ kind: "state", state });
}

async function readState(vaults: DesktopVaultsBridge): Promise<void> {
  try {
    adopt(await vaults.getState());
  } catch (cause) {
    console.warn("[vaults] the shell did not answer", cause);
  }
}

function start(): void {
  if (started) return;
  started = true;
  const vaults = bridge();
  if (vaults === undefined) {
    publish({ kind: "no-bridge" });
    return;
  }
  void readState(vaults);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): VaultsSnapshot {
  return snapshot;
}

export function useDesktopVaults(): VaultsSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// each answers only when nothing moved: a cancelled picker, a forgotten row, or a refusal
// thrown; a switch replaces the window before any answer could land
export async function pickVault(): Promise<void> {
  const vaults = bridge();
  if (vaults === undefined) return;
  adopt(await vaults.pick());
}

export async function openRecentVault(path: string): Promise<void> {
  const vaults = bridge();
  if (vaults === undefined) return;
  adopt(await vaults.open(path));
}

export async function forgetRecentVault(path: string): Promise<void> {
  const vaults = bridge();
  if (vaults === undefined) return;
  adopt(await vaults.forget(path));
}
