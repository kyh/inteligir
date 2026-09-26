import { useMemo, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import * as Crypto from "expo-crypto";
import { File } from "expo-file-system";
import { addNetworkStateListener } from "expo-network";
import {
  clearDeviceCredential,
  readDeviceCredential,
  writeDeviceCredential,
} from "../credential/secure-store-credential";
import { threadDispatches, threadListEntries } from "../dispatch/dispatch-projection";
import type { ThreadDispatches, ThreadListEntry } from "../dispatch/dispatch-projection";
import type {
  AskAgentRequest,
  CancelOutcome,
  DispatchOutcome,
  DispatchState,
} from "../dispatch/dispatch-runtime";
import { createEditorPorts } from "../editor/editor-ports";
import type { EditorPorts, EditorPortsArgs } from "../editor/editor-ports";
import { defaultDeviceName } from "../login/device-name";
import type { LoginRequest, LoginState } from "../login/login-store";
import type { CommentOutcome } from "../notes/comment-ops";
import { createExpoAttachmentFiles } from "../notes/expo-attachment-files";
import { createExpoOutboxFiles } from "../notes/expo-outbox-files";
import type { CreatedNote, RenamedNote } from "../notes/file-ops";
import type { CommentsRead, NoteRead, NoteText, NotesTreeState } from "../notes/notes-store";
import { ingestPhoto } from "../notes/photo-ingest";
import type { OutboxStatus } from "../notes/vault-outbox";
import type { LiveItem } from "../sync/live-turns";
import { rnSocketDial } from "../sync/rn-socket-dial";
import type { SyncStatus } from "../sync/sync-runtime";
import { liveThreadsFirst, projectThread } from "../sync/thread-projection";
import type { ThreadProjection } from "../sync/thread-projection";
import { hexFromBytes } from "@repo/api/cloud/bytes";
import type { CloudFailure } from "@repo/api/cloud/client";
import { createCloudSocketOpener } from "@repo/api/cloud/sync/cloud-socket";
import type { PendingInteractionApprovalDecision } from "@repo/domain/pending-interactions";
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
    mintId: () => hexFromBytes(Crypto.getRandomBytes(16)),
    mintNoteId: Crypto.randomUUID,
    outboxFiles: createExpoOutboxFiles(),
    randomBytes: Crypto.getRandomBytes,
    sha1: async (bytes) =>
      new Uint8Array(await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA1, bytes)),
    sync: { onDebug: devLog, openSocket: createCloudSocketOpener(rnSocketDial) },
  });
  // never removed: the runtime lives as long as the app, and a resume while signed out is a no-op.
  // `inactive` is a passing state on iOS (a pulled-down notification centre), not a departure.
  AppState.addEventListener("change", (state) => {
    if (state === "active") {
      rt.resume();
    } else if (state === "background") {
      rt.suspend();
    }
  });
  // a phone back online sends what it saved offline without waiting for the retry timer; in the
  // background it waits for the foreground, which reopens the socket too
  let online = true;
  addNetworkStateListener((network) => {
    const reachable = network.isInternetReachable ?? network.isConnected ?? false;
    if (reachable && !online && AppState.currentState === "active") {
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

export const createNote = async (dir: string): Promise<CreatedNote> =>
  await getRuntime().fileOps.create(dir);

export const renameNote = async (from: string, name: string): Promise<RenamedNote> =>
  await getRuntime().fileOps.rename(from, name);

export const deleteNote = async (path: string): Promise<void> => {
  await getRuntime().fileOps.remove(path);
};

export const replyToComment = async (
  path: string,
  rootId: string,
  text: string,
): Promise<CommentOutcome> => await getRuntime().comments.reply(path, rootId, text);

export const resolveComment = async (
  path: string,
  rootId: string,
  resolved: boolean,
): Promise<CommentOutcome> => await getRuntime().comments.resolve(path, rootId, resolved);

// the view context's revision: the sha-256 of the note's bytes as the screen showed them
const noteRevision = async (content: string): Promise<string> =>
  hexFromBytes(
    new Uint8Array(
      await Crypto.digest(Crypto.CryptoDigestAlgorithm.SHA256, new TextEncoder().encode(content)),
    ),
  );

// the editor page's ports over the store and the file verbs, bound to their native halves: the
// photo picker, a held file's bytes, the revision hash and a new thread's id
export const createNoteEditorPorts = (
  screen: Pick<EditorPortsArgs, "go" | "notify" | "opened" | "showComments">,
): EditorPorts => {
  const rt = getRuntime();
  return createEditorPorts({
    ...screen,
    comments: rt.comments,
    fileOps: rt.fileOps,
    newThreadId: () => rt.dispatch.newThreadId(),
    pickImage: async () => await ingestPhoto(rt.fileOps),
    readBase64: async (uri) => await new File(uri).base64(),
    revisionOf: noteRevision,
    store: rt.notes,
  });
};

// one per load of the editor page
export const mintBridgeNonce = (): string => hexFromBytes(Crypto.getRandomBytes(16));

export const useNotesTree = (): NotesTreeState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.notes.tree.subscribe, rt.notes.tree.get);
};

// what has not reached the vault: the parked changes and the conflicts the queue settled
export const useOutboxStatus = (): OutboxStatus => {
  const { status } = getRuntime().notes.outbox;
  return useSyncExternalStore(status.subscribe, status.get);
};

export const retryUnsent = async (seq: number): Promise<void> => {
  await getRuntime().notes.outbox.retry(seq);
};

// the path the change was kept at, or null when it had nothing to keep
export const saveUnsentAsNew = async (seq: number): Promise<string | null> =>
  await getRuntime().notes.outbox.saveAsNew(seq);

export const discardUnsent = async (seq: number): Promise<void> => {
  await getRuntime().notes.outbox.discard(seq);
};

export const dismissSyncNotice = (id: number): void => {
  getRuntime().notes.outbox.dismiss(id);
};

export const useSyncStatus = (): SyncStatus => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.sync.subscribe, rt.sync.get);
};

export const useLoginState = (): LoginState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.login.subscribe, rt.login.get);
};

const useDispatchState = (): DispatchState => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.dispatch.subscribe, rt.dispatch.get);
};

// the synced threads and those that so far exist only on this phone, each with what it is doing
export const useThreadList = (): readonly ThreadListEntry[] => {
  const rt = getRuntime();
  const threads = useSyncExternalStore(rt.store.subscribeThreads, rt.store.snapshotThreads);
  const dispatches = useDispatchState();
  return useMemo(
    () =>
      threadListEntries(
        liveThreadsFirst(threads.map((thread) => projectThread(thread))),
        dispatches,
      ),
    [threads, dispatches],
  );
};

export const useThread = (threadId: string): ThreadProjection | null => {
  const rt = getRuntime();
  const thread = useSyncExternalStore(rt.store.subscribeThreads, () =>
    rt.store.snapshotThread(threadId),
  );
  return useMemo(() => (thread === null ? null : projectThread(thread)), [thread]);
};

// what the thread's running turn has streamed so far, cleared as its items settle
export const useLiveItems = (threadId: string): readonly LiveItem[] => {
  const rt = getRuntime();
  return useSyncExternalStore(rt.live.subscribe, () => rt.live.snapshot(threadId));
};

export const useDispatches = (threadId: string): ThreadDispatches => {
  const thread = useThread(threadId);
  const dispatches = useDispatchState();
  return useMemo(
    () => threadDispatches(threadId, thread, dispatches),
    [threadId, thread, dispatches],
  );
};

export const askAgent = async (request: AskAgentRequest): Promise<DispatchOutcome> =>
  await getRuntime().dispatch.askAgent(request);

export const answerApproval = async (
  approvalId: string,
  decision: PendingInteractionApprovalDecision,
): Promise<DispatchOutcome> => await getRuntime().dispatch.answer(approvalId, decision);

export const cancelDispatch = async (id: string): Promise<CancelOutcome> =>
  await getRuntime().dispatch.cancel(id);

export const dismissDispatch = async (id: string): Promise<void> => {
  await getRuntime().dispatch.dismiss(id);
};
