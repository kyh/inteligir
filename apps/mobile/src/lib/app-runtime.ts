// The composition root: it binds the PURE sync client (src/sync), the credential
// store (expo-secure-store) and the pairing manager into one process-wide
// singleton, and exposes the React hooks the screens read. Everything device-
// specific enters HERE; the modules it wires are unit-tested without it.

import { useCallback, useMemo, useState, useSyncExternalStore } from "react";
import type { DeviceCredential } from "../credential/credential-codec";
import { createSecureStoreCredential } from "../credential/secure-store-credential";
import type { CredentialStore } from "../credential/credential-store";
import {
  createPairingManager,
  type PairCompletion,
  type PairingManager,
} from "../pairing/pairing-manager";
import {
  defaultDeviceName,
  expoPkceCrypto,
  openApproveAndAwait,
  pairCallbackUrl,
  parsePairCallback,
} from "../pairing/expo-pairing";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import {
  createNotesStore,
  type NoteRead,
  type NotesStore,
  type NotesTreeState,
} from "../notes/notes-store";
import { createSyncRuntime, type SyncRuntime, type SyncStatus } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { projectThread, type ThreadProjection } from "../sync/thread-projection";
import { createExternalStore, type ExternalStore } from "./external-store";
import { getCloudUrl } from "./cloud-url";

interface AppRuntime {
  store: SyncStore;
  sync: SyncRuntime;
  notes: NotesStore;
  pairing: PairingManager;
  credentials: CredentialStore;
  cloudUrl: string;
  status: ExternalStore<SyncStatus>;
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
  const pairing = createPairingManager({
    cloudUrl,
    callbackUrl: pairCallbackUrl(),
    crypto: expoPkceCrypto,
    defaultDeviceName: defaultDeviceName(),
  });
  return {
    store,
    sync,
    notes: createNotesStore({ cloudUrl }),
    pairing,
    credentials: createSecureStoreCredential(),
    cloudUrl,
    status: createExternalStore<SyncStatus>({ state: "off" }),
    removeDeepLink: null,
  };
}

function getRuntime(): AppRuntime {
  runtime ??= build();
  return runtime;
}

function refreshStatus(rt: AppRuntime): void {
  rt.status.set(rt.sync.status());
}

async function finishPairing(rt: AppRuntime, credential: DeviceCredential): Promise<void> {
  await rt.credentials.write(credential);
  rt.sync.setCredential(credential);
  rt.notes.setCredential(credential);
  rt.sync.start();
  refreshStatus(rt);
}

/** The one place a pairing outcome becomes state — shared by the in-session
 *  browser return and the cold deep-link listener. Returns a user-facing line
 *  for a failure, or null on success. */
async function applyCompletion(rt: AppRuntime, completion: PairCompletion): Promise<string | null> {
  switch (completion.kind) {
    case "paired":
      await finishPairing(rt, completion.credential);
      return null;
    case "no-pending":
      return null;
    case "state-mismatch":
      return "That approval did not match the pairing this app started.";
    case "expired":
      return "The pairing took too long — start another.";
    case "refused":
      return completion.failure.message;
  }
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
    void rt.pairing.completePair(parsed).then((completion) => applyCompletion(rt, completion));
  });
  rt.removeDeepLink = () => {
    subscription.remove();
  };
  const stored = await rt.credentials.read();
  if (stored !== null) {
    rt.sync.setCredential(stored);
    rt.notes.setCredential(stored);
    rt.sync.start();
  }
  refreshStatus(rt);
}

/** Run one sync pass now (foreground / pull-to-refresh). */
export async function syncNow(): Promise<void> {
  const rt = getRuntime();
  await rt.sync.syncNow();
  refreshStatus(rt);
}

export async function unpair(): Promise<void> {
  const rt = getRuntime();
  await rt.credentials.clear();
  rt.sync.setCredential(null);
  rt.notes.setCredential(null);
  refreshStatus(rt);
}

/** POST a quick capture to the inbox. The desktop applies it to the vault. */
export async function submitCapture(text: string): Promise<{ ok: boolean; message: string }> {
  const rt = getRuntime();
  const result = await rt.sync.createCapture({ text, idempotencyKey: newIdempotencyKey() });
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

// -- React hooks ------------------------------------------------------------

export function useNotesTree(): NotesTreeState {
  const rt = getRuntime();
  return useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
}

export function useSyncStatus(): SyncStatus {
  const rt = getRuntime();
  return useSyncExternalStore(rt.status.subscribe, rt.status.get);
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

type PairPhase = "idle" | "opening" | "error";

export interface PairingControls {
  phase: PairPhase;
  message: string | null;
  startPair: () => Promise<void>;
}

export function usePairing(): PairingControls {
  const rt = getRuntime();
  const [phase, setPhase] = useState<PairPhase>("idle");
  const [message, setMessage] = useState<string | null>(null);

  const startPair = useCallback(async () => {
    setPhase("opening");
    setMessage(null);
    const begun = await rt.pairing.beginPair();
    const back = await openApproveAndAwait(begun.approveUrl, begun.callbackUrl);
    if (back === null) {
      rt.pairing.cancel();
      setPhase("idle");
      return;
    }
    const completion = await rt.pairing.completePair(back);
    const failure = await applyCompletion(rt, completion);
    if (failure === null) {
      setPhase("idle");
    } else {
      setMessage(failure);
      setPhase("error");
    }
  }, [rt]);

  return { phase, message, startPair };
}
