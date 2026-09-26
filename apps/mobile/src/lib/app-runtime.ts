import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { addNetworkStateListener } from "expo-network";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential/secure-store-credential";
import { defaultDeviceName } from "../login/device-name";
import type { LoginRequest, LoginState } from "../login/login-store";
import { createExpoAttachmentFiles } from "../notes/expo-attachment-files";
import { createExpoOutboxFiles } from "../notes/expo-outbox-files";
import type { CommentsRead, NoteRead, NoteText, NotesTreeState } from "../notes/notes-store";
import type { SyncStatus } from "../sync/sync-runtime";
import { liveThreadsFirst, projectThread } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import type { CloudFailure, VaultAssetSource } from "@repo/api/cloud/client";
import { getCloudUrl } from "./cloud-url";
import { composeRuntime } from "./compose-runtime";
import type { AppRuntime, LogoutOutcome } from "./compose-runtime";
import { createExpoSqlDriver } from "./expo-sql-driver";

let runtime: AppRuntime | null = null;

// console.warn would raise a LogBox toast per skipped row or offline pass.
const devLog = (message: string): void => {
  if (__DEV__) {
    console.log(`sync: ${message}`);
  }
};

const build = (): AppRuntime => {
  const rt = composeRuntime({
    attachments: createExpoAttachmentFiles(),
    cloudUrl: getCloudUrl(),
    credentials: {
      clear: clearDeviceCredential,
      read: readDeviceCredential,
      write: writeDeviceCredential,
    },
    db: createExpoSqlDriver("inteligir.db"),
    deviceName: defaultDeviceName(),
    // the contract requires an idempotency key of at least 8 chars.
    mintCaptureKey: () => hexFromBytes(Crypto.getRandomBytes(16)),
    outboxFiles: createExpoOutboxFiles(),
    sha1: async (bytes) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, bytes)),
    sync: { onDebug: devLog },
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      rt.resume();
    }
  });
  // a phone back online sends what it saved offline without waiting for the retry timer
  let online = true;
  addNetworkStateListener((network) => {
    const reachable = network.isInternetReachable ?? network.isConnected ?? false;
    if (reachable && !online) {
      rt.resume();
    }
    online = reachable;
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

export const logout = async (options?: { discardUnsent?: boolean }): Promise<LogoutOutcome> =>
  await getRuntime().logout(options);

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

export const readNoteComments = async (note: NoteText): Promise<CommentsRead> =>
  await getRuntime().notes.readComments(note);

export const resolveWikiPath = (target: string, alias?: string): string | null =>
  getRuntime().notes.resolveWiki(target, alias);

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
