import { useMemo, useSyncExternalStore } from "react";
import * as Crypto from "expo-crypto";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential/secure-store-credential";
import { createLoginStore } from "../login/login-store";
import type { LoginRequest, LoginState, LoginStore } from "../login/login-store";
import { createMemorySyncStore } from "../sync/memory-sync-store";
import { createExpoNoteCache } from "../notes/expo-note-cache";
import { createNotesStore } from "../notes/notes-store";
import type {
  CredentialHandover,
  CommentsRead,
  NoteRead,
  NotesStore,
  NotesTreeState,
} from "../notes/notes-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncStatus } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { projectThread } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
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
const activate = (rt: Pick<AppRuntime, "sync" | "notes">, handover: CredentialHandover): void => {
  rt.sync.setCredential(handover.credential);
  rt.notes.setCredential(handover);
  rt.sync.start();
  void rt.notes.refresh();
};

let runtime: AppRuntime | null = null;

// a misconfigured build should say "could not reach the cloud" rather than crash on first render.
const resolveCloudUrl = (): string => {
  try {
    return getCloudUrl();
  } catch {
    return "http://cloud.invalid";
  }
};

const build = (): AppRuntime => {
  const store = createMemorySyncStore();
  const cloudUrl = resolveCloudUrl();
  const sync = createSyncRuntime({ cloudUrl, store });
  const notes = createNotesStore({ cache: createExpoNoteCache(), cloudUrl });
  const login = createLoginStore({
    client: { baseUrl: cloudUrl },
    store: {
      write: async (credential) => {
        await writeDeviceCredential(credential);
        activate({ notes, sync }, { credential, source: "signed-in" });
      },
    },
  });
  return { login, notes, started: false, store, sync };
};

const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  const rt = getRuntime();
  if (rt.started) {
    return;
  }
  rt.started = true;
  const stored = await readDeviceCredential();
  if (stored !== null) {
    activate(rt, { credential: stored, source: "restored" });
  }
};

export const syncNow = async (): Promise<void> => {
  await getRuntime().sync.syncNow();
};

export const logout = async (): Promise<void> => {
  const rt = getRuntime();
  await clearDeviceCredential();
  rt.sync.setCredential(null);
  rt.notes.setCredential(null);
};

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

// the contract requires an idempotency key of at least 8 chars.
const newIdempotencyKey = (): string => hexFromBytes(Crypto.getRandomBytes(16));

export const submitCapture = async (
  text: string,
): Promise<{ ok: true } | { ok: false; failure: CloudFailure }> => {
  const result = await getRuntime().sync.createCapture({
    idempotencyKey: newIdempotencyKey(),
    text,
  });
  return result.ok ? { ok: true } : { failure: result.failure, ok: false };
};

export const refreshNotes = async (): Promise<void> => {
  await getRuntime().notes.refresh();
};

export const readNote = async (path: string): Promise<NoteRead> =>
  await getRuntime().notes.readNote(path);

export const readNoteComments = async (path: string): Promise<CommentsRead> =>
  await getRuntime().notes.readComments(path);

export const resolveWikiPath = (target: string): string | null =>
  getRuntime().notes.resolveWiki(target);

export const assetSource = (path: string): VaultAssetSource | null =>
  getRuntime().notes.assetSource(path);

export const useNotesTree = (): NotesTreeState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
};

export const useSyncStatus = (): SyncStatus => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};

export const useThreads = (): readonly ThreadProjection[] => {
  const rt = getRuntime();
  const threads = useSyncExternalStore(rt.store.subscribeThreads, rt.store.snapshotThreads);
  return useMemo(() => threads.map((thread) => projectThread(thread)), [threads]);
};

export const useThread = (threadId: string): ThreadProjection | null => {
  const rt = getRuntime();
  const thread = useSyncExternalStore(rt.store.subscribeThreads, () =>
    rt.store.snapshotThread(threadId),
  );
  return useMemo(() => (thread === null ? null : projectThread(thread)), [thread]);
};
