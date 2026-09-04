// The updater lives in main; the page mirrors its state off the bridge. The
// preload parses every frame before it lands here, so this store only ever
// holds a state it knows. Outside the shell there is no bridge, and the page
// says so instead of pretending.

import { useSyncExternalStore } from "react";
import type { DesktopUpdatesBridge } from "../../types";
import type { UpdateAction, UpdateState } from "../../update-state";

export type UpdatesSnapshot =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: UpdateState };

const listeners = new Set<() => void>();
let snapshot: UpdatesSnapshot = { kind: "loading" };
let started = false;

function bridge(): DesktopUpdatesBridge | undefined {
  return window.desktopBridge?.updates;
}

function publish(next: UpdatesSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function adopt(state: UpdateState): void {
  publish({ kind: "state", state });
}

async function readInitialState(updates: DesktopUpdatesBridge): Promise<void> {
  try {
    adopt(await updates.getState());
  } catch (cause) {
    console.warn("[updates] the initial state read failed", cause);
  }
}

function start(): void {
  if (started) return;
  started = true;
  const updates = bridge();
  if (updates === undefined) {
    publish({ kind: "no-bridge" });
    return;
  }
  updates.onState(adopt);
  void readInitialState(updates);
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): UpdatesSnapshot {
  return snapshot;
}

export function useDesktopUpdates(): UpdatesSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// each action answers with the state it left behind, adopted like a pushed frame
export async function runUpdateAction(action: UpdateAction): Promise<void> {
  const updates = bridge();
  if (updates === undefined) return;
  adopt(await updates[action]());
}
