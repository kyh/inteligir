// The composition root: it binds the PURE sync client (src/sync), the credential
// store (expo-secure-store) and the pairing flow into one process-wide
// singleton, and exposes the React hooks the screens read. Everything device-
// specific enters HERE; the modules it wires are unit-tested without it.
//
// EVERY HOOK READS A STORE ITS OWNER PUBLISHES. Sync status, the notes tree and
// the pairing flow each move on their own clock — a poll pass, a page fetch, a
// deep link — with no caller on this side to hand the answer to, so the module
// that moves the value is the one that notifies; nothing here mirrors a value
// it would then have to remember to refresh.

import { useMemo, useSyncExternalStore } from "react";
import { createSecureStoreCredential } from "../credential/secure-store-credential";
import type { CredentialStore } from "../credential/credential-store";
import { createPairingManager } from "../pairing/pairing-manager";
import { createPairingFlow, type PairingFlow, type PairingState } from "../pairing/pairing-flow";
import {
  defaultDeviceName,
  expoPkceCrypto,
  openApproveAndAwait,
  pairCallbackUrl,
  parsePairCallback,
} from "../pairing/expo-pairing";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import { createExpoNoteCache } from "../notes/expo-note-cache";
import {
  createNotesStore,
  type NoteRead,
  type NotesStore,
  type NotesTreeState,
} from "../notes/notes-store";
import { createSyncRuntime, type SyncRuntime, type SyncStatus } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { projectThread, type ThreadProjection } from "../sync/thread-projection";
import type { VaultAssetSource } from "@repo/api/cloud/client";
import { getCloudUrl } from "./cloud-url";

interface AppRuntime {
  store: SyncStore;
  sync: SyncRuntime;
  notes: NotesStore;
  pairing: PairingFlow;
  credentials: CredentialStore;
  removeDeepLink: (() => void) | null;
}

let runtime: AppRuntime | null = null;

/** The cloud origin, or a clearly-invalid placeholder when unconfigured — a
 *  misconfigured build then shows "could not reach the cloud" rather than
 *  crashing on first render. */
function resolveCloudUrl(): string {
  try {
    return getCloudUrl();
  } catch {
    return "http://cloud.invalid";
  }
}

function build(): AppRuntime {
  const store = createMemorySyncStore();
  const cloudUrl = resolveCloudUrl();
  const sync = createSyncRuntime({ store, cloudUrl });
  const notes = createNotesStore({ cloudUrl, cache: createExpoNoteCache() });
  const credentials = createSecureStoreCredential();
  const callbackUrl = pairCallbackUrl();
  const pairing = createPairingFlow({
    manager: createPairingManager({
      cloudUrl,
      callbackUrl,
      crypto: expoPkceCrypto,
      deviceName: defaultDeviceName(),
    }),
    openApprove: (approveUrl) => openApproveAndAwait(approveUrl, callbackUrl),
    onPaired: async (credential) => {
      await credentials.write(credential);
      sync.setCredential(credential);
      notes.setCredential({ credential, source: "paired" });
      sync.start();
      // The read model starts where sync does: a screen that reads the tree
      // should not each carry its own "if it is cold, fetch it" effect.
      void notes.refresh();
    },
  });
  return { store, sync, notes, pairing, credentials, removeDeepLink: null };
}

function getRuntime(): AppRuntime {
  runtime ??= build();
  return runtime;
}

/**
 * Read any stored credential, arm the deep-link listener, and start syncing.
 * Idempotent — the root layout calls it once per launch.
 */
export async function ensureStarted(): Promise<void> {
  const rt = getRuntime();
  if (rt.removeDeepLink !== null) return;
  // A redirect can arrive as a fresh deep-link when the app was backgrounded
  // during browser approval — handle it here as well as the in-session return.
  const { addEventListener } = await import("expo-linking");
  const subscription = addEventListener("url", (event) => {
    const parsed = parsePairCallback(event.url);
    if (parsed === null) return;
    void rt.pairing.complete(parsed);
  });
  rt.removeDeepLink = () => {
    subscription.remove();
  };
  const stored = await rt.credentials.read();
  if (stored !== null) {
    rt.sync.setCredential(stored);
    rt.notes.setCredential({ credential: stored, source: "restored" });
    rt.sync.start();
    void rt.notes.refresh();
  }
}

/** Run one sync pass now (foreground / pull-to-refresh). */
export function syncNow(): Promise<void> {
  return getRuntime().sync.syncNow();
}

export async function unpair(): Promise<void> {
  const rt = getRuntime();
  await rt.credentials.clear();
  rt.sync.setCredential(null);
  rt.notes.setCredential(null);
}

/** Begin a browser-approve pairing; `usePairingState` follows it. */
export function startPair(): Promise<void> {
  return getRuntime().pairing.startPair();
}

/** POST a quick capture to the inbox. The desktop applies it to the vault. */
export async function submitCapture(text: string): Promise<{ ok: boolean; message: string }> {
  const result = await getRuntime().sync.createCapture({
    text,
    idempotencyKey: newIdempotencyKey(),
  });
  if (!result.ok) return { ok: false, message: result.failure.message };
  return { ok: true, message: "Captured" };
}

/** A stable idempotency key for a capture retry — the contract wants ≥ 8 chars;
 *  16 random bytes as hex is 32. */
function newIdempotencyKey(): string {
  const bytes = expoPkceCrypto.randomBytes(16);
  let hex = "";
  for (const byte of bytes) hex += byte.toString(16).padStart(2, "0");
  return hex;
}

/** Fetch (or re-fetch) the vault tree; the hook below re-renders on it. */
export async function refreshNotes(): Promise<void> {
  await getRuntime().notes.refresh();
}

/** One note's text at the tree's commit — cached, bounded. */
export function readNote(path: string): Promise<NoteRead> {
  return getRuntime().notes.readNote(path);
}

/** A wiki target's vault path over the last refreshed tree, or null. */
export function resolveWikiPath(target: string): string | null {
  return getRuntime().notes.resolveWiki(target);
}

/** An image embed's source at the tree's commit, or null. */
export function assetSource(path: string): VaultAssetSource | null {
  return getRuntime().notes.assetSource(path);
}

// -- React hooks ------------------------------------------------------------

export function useNotesTree(): NotesTreeState {
  const rt = getRuntime();
  return useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
}

export function useSyncStatus(): SyncStatus {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
}

export function usePairingState(): PairingState {
  const rt = getRuntime();
  return useSyncExternalStore(rt.pairing.subscribe, rt.pairing.get);
}

export function useThreads(): readonly ThreadProjection[] {
  const rt = getRuntime();
  const threads = useSyncExternalStore(rt.store.subscribeThreads, rt.store.snapshotThreads);
  return useMemo(() => threads.map((thread) => projectThread(thread)), [threads]);
}

export function useThread(threadId: string): ThreadProjection | null {
  const rt = getRuntime();
  const thread = useSyncExternalStore(rt.store.subscribeThreads, () =>
    rt.store.snapshotThread(threadId),
  );
  return useMemo(() => (thread === null ? null : projectThread(thread)), [thread]);
}
