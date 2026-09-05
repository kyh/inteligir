// The spell checker is the window session's, so main switches it; the page keeps the
// choice in its own prefs and mirrors main's answer off the bridge. Outside the shell
// there is no bridge and no row: a browser tab owns its own spell check.

import { useSyncExternalStore } from "react";
import type { DesktopSpellcheckBridge } from "../../types";
import type { SpellcheckChoice, SpellcheckState } from "../../spellcheck-state";
import { readSpellcheck, writeSpellcheck } from "./prefs";

export type SpellcheckSnapshot =
  | { kind: "loading" }
  | { kind: "no-bridge" }
  | { kind: "state"; state: SpellcheckState };

const listeners = new Set<() => void>();
let snapshot: SpellcheckSnapshot = { kind: "loading" };
let started = false;

function bridge(): DesktopSpellcheckBridge | undefined {
  return window.desktopBridge?.spellcheck;
}

function publish(next: SpellcheckSnapshot): void {
  snapshot = next;
  for (const listener of listeners) listener();
}

function adopt(state: SpellcheckState): void {
  publish({ kind: "state", state });
}

// launch: the stored choice, else what the session already holds
export async function applyStoredSpellcheck(): Promise<void> {
  const spellcheck = bridge();
  if (spellcheck === undefined) return;
  const stored = readSpellcheck();
  try {
    adopt(stored === null ? await spellcheck.getState() : await spellcheck.apply(stored));
  } catch (cause) {
    console.warn("[spellcheck] the session did not answer", cause);
  }
}

function start(): void {
  if (started) return;
  started = true;
  if (bridge() === undefined) {
    publish({ kind: "no-bridge" });
    return;
  }
  if (snapshot.kind === "loading") void applyStoredSpellcheck();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): SpellcheckSnapshot {
  return snapshot;
}

export function useDesktopSpellcheck(): SpellcheckSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot);
}

// the pref is written first, so a session that refuses still remembers what was asked
export async function chooseSpellcheck(choice: SpellcheckChoice): Promise<void> {
  const spellcheck = bridge();
  if (spellcheck === undefined) return;
  writeSpellcheck(choice);
  adopt(await spellcheck.apply(choice));
}
