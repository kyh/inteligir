import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential/secure-store-credential";
import type { LoginRequest, LoginState } from "../login/login-store";
import { createExpoNoteCache } from "../notes/expo-note-cache";
import type { CachedNote } from "../notes/note-cache";
import type { CommentsRead, NoteRead, NotesTreeState } from "../notes/notes-store";
import type { SyncStatus } from "../sync/sync-runtime";
import { liveThreadsFirst, projectThread } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import type { CloudFailure, VaultAssetSource } from "@repo/api/cloud/client";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime } from "./compose-runtime";

let runtime: AppRuntime | null = null;

// a misconfigured build should say "could not reach the cloud" rather than crash on first render.
const resolveCloudUrl = (): string => {
  try {
    return getCloudUrl();
  } catch {
    return "http://cloud.invalid";
  }
};

// console.warn would raise a LogBox toast per skipped row or offline pass.
const devLog = (message: string): void => {
  if (__DEV__) {
    console.log(`sync: ${message}`);
  }
};

const build = (): AppRuntime => {
  const rt = composeRuntime({
    cache: createExpoNoteCache(),
    cloudUrl: resolveCloudUrl(),
    credentials: {
      clear: clearDeviceCredential,
      read: readDeviceCredential,
      write: writeDeviceCredential,
    },
    // the contract requires an idempotency key of at least 8 chars.
    mintCaptureKey: () => hexFromBytes(Crypto.getRandomBytes(16)),
    sync: { onDebug: devLog },
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      rt.resume();
    }
  });
  return rt;
};

const getRuntime = (): AppRuntime => {
  runtime ??= build();
  return runtime;
};

export const ensureStarted = async (): Promise<void> => {
  await getRuntime().start();
};

export const syncNow = async (): Promise<void> => {
  await getRuntime().sync.syncNow();
};

export const logout = async (): Promise<void> => {
  await getRuntime().logout();
};

export const login = async (request: LoginRequest): Promise<void> => {
  await getRuntime().login.login(request);
};

export const submitCapture = async (
  text: string,
): Promise<{ ok: true } | { ok: false; failure: CloudFailure }> => {
  const result = await getRuntime().submitCapture(text);
  return result.ok ? { ok: true } : { failure: result.failure, ok: false };
};

export const refreshNotes = async (): Promise<void> => {
  await getRuntime().notes.refresh();
};

export const readNote = async (path: string): Promise<NoteRead> =>
  await getRuntime().notes.readNote(path);

export const readNoteComments = async (note: CachedNote): Promise<CommentsRead> =>
  await getRuntime().notes.readComments(note);

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
  return useMemo(() => liveThreadsFirst(threads.map((thread) => projectThread(thread))), [threads]);
};

export const useThread = (threadId: string): ThreadProjection | null => {
  const rt = getRuntime();
  const thread = useSyncExternalStore(rt.store.subscribeThreads, () =>
    rt.store.snapshotThread(threadId),
  );
  return useMemo(() => (thread === null ? null : projectThread(thread)), [thread]);
};
