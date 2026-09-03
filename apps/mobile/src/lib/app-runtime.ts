import { useMemo, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential/secure-store-credential";
import {
  createLoginStore,
  type LoginRequest,
  type LoginState,
  type LoginStore,
} from "../login/login-store";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import { createExpoNoteCache } from "../notes/expo-note-cache";
import {
  createNotesStore,
  type CredentialHandover,
  type NoteRead,
  type NotesStore,
  type NotesTreeState,
} from "../notes/notes-store";
import { createSyncRuntime, type SyncRuntime, type SyncStatus } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { projectThread, type ThreadProjection } from "../sync/thread-projection";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import type { CloudFailure, VaultAssetSource } from "@repo/api/cloud/client";
import { getCloudUrl } from "./cloud-url";

interface AppRuntime {
  store: SyncStore;
  sync: SyncRuntime;
  notes: NotesStore;
  login: LoginStore;
  started: boolean;
}

// the tree is fetched here so no screen carries its own cold-fetch effect.
function activate(rt: Pick<AppRuntime, "sync" | "notes">, handover: CredentialHandover): void {
  rt.sync.setCredential(handover.credential);
  rt.notes.setCredential(handover);
  rt.sync.start();
  void rt.notes.refresh();
}

let runtime: AppRuntime | null = null;

// a misconfigured build should say "could not reach the cloud" rather than crash on first render.
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
  const login = createLoginStore({
    client: { baseUrl: cloudUrl },
    store: {
      write: async (credential) => {
        await writeDeviceCredential(credential);
        activate({ sync, notes }, { credential, source: "signed-in" });
      },
    },
  });
  return { store, sync, notes, login, started: false };
}

function getRuntime(): AppRuntime {
  runtime ??= build();
  return runtime;
}

export async function ensureStarted(): Promise<void> {
  const rt = getRuntime();
  if (rt.started) return;
  rt.started = true;
  const stored = await readDeviceCredential();
  if (stored !== null) activate(rt, { credential: stored, source: "restored" });
}

export function syncNow(): Promise<void> {
  return getRuntime().sync.syncNow();
}

export async function logout(): Promise<void> {
  const rt = getRuntime();
  await clearDeviceCredential();
  rt.sync.setCredential(null);
  rt.notes.setCredential(null);
}

export function login(request: LoginRequest): Promise<void> {
  return getRuntime().login.login(request);
}

export async function submitCapture(
  text: string,
): Promise<{ ok: true } | { ok: false; failure: CloudFailure }> {
  const result = await getRuntime().sync.createCapture({
    text,
    idempotencyKey: newIdempotencyKey(),
  });
  return result.ok ? { ok: true } : { ok: false, failure: result.failure };
}

// the contract requires an idempotency key of at least 8 chars.
function newIdempotencyKey(): string {
  return hexFromBytes(Crypto.getRandomBytes(16));
}

export async function refreshNotes(): Promise<void> {
  await getRuntime().notes.refresh();
}

export function readNote(path: string): Promise<NoteRead> {
  return getRuntime().notes.readNote(path);
}

export function resolveWikiPath(target: string): string | null {
  return getRuntime().notes.resolveWiki(target);
}

export function assetSource(path: string): VaultAssetSource | null {
  return getRuntime().notes.assetSource(path);
}

export function useNotesTree(): NotesTreeState {
  const rt = getRuntime();
  return useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
}

export function useSyncStatus(): SyncStatus {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
}

export function useLoginState(): LoginState {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
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
