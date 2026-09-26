// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, the attachment and outbox files, SHA-1 and the OS, so every transition between signed
// in and out runs under test, and the scenario suite drives it under node against a real Worker.

import type { DeviceCredential } from "@repo/api/cloud/device/device-schema";
import type { DeviceCredentialStore } from "@repo/api/cloud/device/login-flow";
import { createCaptureSender } from "../capture/capture-sender";
import type { CaptureSender } from "../capture/capture-sender";
import { createDispatchRuntime } from "../dispatch/dispatch-runtime";
import type { DispatchRuntime, DispatchRuntimeArgs } from "../dispatch/dispatch-runtime";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import type { AttachmentFiles } from "../notes/attachment-files";
import { createFileOps } from "../notes/file-ops";
import type { FileOps } from "../notes/file-ops";
import { createNotesStore } from "../notes/notes-store";
import type { CreateNotesStoreArgs, NotesStore, SignInSource } from "../notes/notes-store";
import type { Sha1 } from "../notes/outbox-ops";
import type { OutboxFiles } from "../notes/outbox-files";
import { createLiveTurns } from "../sync/live-turns";
import type { LiveTurns } from "../sync/live-turns";
import { createSqliteSyncStore } from "../sync/sqlite-sync-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import type { SqlDriver } from "./sql-driver";

export interface CredentialStore extends DeviceCredentialStore {
  read: () => Promise<DeviceCredential | null>;
  clear: () => Promise<void>;
}

export interface ComposeRuntimeArgs {
  cloudUrl: string;
  credentials: CredentialStore;
  // opened once for the app's life; a restore keeps what it holds, every other sign-in wipes it
  db: SqlDriver;
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  // the name the phone signs in as, which its conflict reports and copies go by
  deviceName: string;
  // 16 random bytes as hex: a capture's idempotency key, a dispatch's id and a new thread's
  mintId: () => string;
  sync?: Omit<SyncRuntimeArgs, "cloudUrl" | "onDispatchPing" | "onVaultPing" | "store">;
  // the first wait after a failed send of the phone's edits; null never retries on a timer
  retryBaseMs?: number | null;
  // how often a waiting request's fate is asked; null never polls on a timer
  dispatchPollIntervalMs?: DispatchRuntimeArgs["pollIntervalMs"];
}

// `unsent`: the phone holds edits the vault has not taken, or requests no Mac holds yet, and signing
// out would discard them
export type LogoutOutcome =
  | { kind: "signed-out" }
  | { kind: "unsent"; edits: number; requests: number };

export interface AppRuntime {
  store: SyncStore;
  // what a running turn has streamed and not yet settled; the store holds the settled items
  live: Pick<LiveTurns, "snapshot" | "subscribe">;
  sync: SyncRuntime;
  notes: NotesStore;
  fileOps: FileOps;
  dispatch: DispatchRuntime;
  login: LoginStore;
  // reads the stored credential once and ends `restoring` either way
  start: () => Promise<void>;
  // refuses while edits or requests are unsent, unless told to discard them
  logout: (options?: { discardUnsent?: boolean }) => Promise<LogoutOutcome>;
  // the app is back in the foreground or back online; every one no-ops while signed out
  resume: () => void;
  // the app left the foreground: the socket closes and nothing polls until it resumes
  suspend: () => void;
  submitCapture: CaptureSender;
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const live = createLiveTurns();
  const store = createSqliteSyncStore({ db: args.db, live, sha1: args.sha1 });
  // the pings reach the notes and the dispatch runtimes, which read under the sync runtime's
  // session and so are built after it; bound below, before start() can open the socket
  let pinged: { vault: () => void; dispatch: () => void } | null = null;
  const sync = createSyncRuntime({
    ...args.sync,
    cloudUrl: args.cloudUrl,
    onDispatchPing: () => {
      pinged?.dispatch();
    },
    onVaultPing: () => {
      pinged?.vault();
    },
    store,
  });
  const notesArgs: CreateNotesStoreArgs = {
    attachments: args.attachments,
    db: args.db,
    deviceName: args.deviceName,
    outboxFiles: args.outboxFiles,
    session: sync.session,
    sha1: args.sha1,
  };
  if (args.retryBaseMs !== undefined) {
    notesArgs.retryBaseMs = args.retryBaseMs;
  }
  const notes = createNotesStore(notesArgs);
  const dispatchArgs: DispatchRuntimeArgs = {
    db: args.db,
    mintId: args.mintId,
    pull: () => {
      void sync.syncNow();
    },
    session: sync.session,
    threads: store,
  };
  if (args.dispatchPollIntervalMs !== undefined) {
    dispatchArgs.pollIntervalMs = args.dispatchPollIntervalMs;
  }
  if (args.sync?.onDebug !== undefined) {
    dispatchArgs.onDebug = args.sync.onDebug;
  }
  const dispatch = createDispatchRuntime(dispatchArgs);
  pinged = {
    dispatch: () => {
      void dispatch.sendNow();
    },
    vault: () => {
      void notes.refresh();
    },
  };

  // the tree is fetched here so no screen carries its own cold-fetch effect, and the edits and
  // requests the last launch left are sent. a restore's threads are read back before the sign-in
  // is published, so the list mounts on what the last launch held and the first pull starts at
  // its cursor.
  const activate = async (credential: DeviceCredential, source: SignInSource): Promise<void> => {
    await store.reset(source);
    sync.setCredential(credential);
    notes.reset(source);
    dispatch.reset(source);
    sync.start();
    void notes.refresh();
    void notes.drain();
    void dispatch.sendNow();
  };

  const login = createLoginStore({
    client: { baseUrl: args.cloudUrl },
    store: {
      write: async (credential) => {
        await args.credentials.write(credential);
        await activate(credential, "signed-in");
      },
    },
  });

  // whichever request hears the refusal, what this sign-in fetched is not served again. the
  // credential stays stored, so the sign-in screen can still say this device was signed out.
  let previous = sync.get().state;
  sync.subscribe(() => {
    const { state } = sync.get();
    if (state === "unauthorized" && previous !== "unauthorized") {
      notes.reset(null);
      dispatch.reset(null);
      void store.reset(null);
    }
    previous = state;
  });

  let started = false;

  return {
    fileOps: createFileOps(notes),
    async logout(options = {}) {
      const [edits, requests] = await Promise.all([notes.unsentCount(), dispatch.unclaimedCount()]);
      if (edits + requests > 0 && options.discardUnsent !== true) {
        return { edits, kind: "unsent", requests };
      }
      // cleared before the runtimes stop: a sign-in the screen allows once they have would write
      // a credential this delete could then remove.
      try {
        await args.credentials.clear();
      } catch (error) {
        login.fail(
          `Signed out, but the saved sign-in could not be removed and may return on the next launch: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      sync.setCredential(null);
      notes.reset(null);
      dispatch.reset(null);
      await store.reset(null);
      return { kind: "signed-out" };
    },
    dispatch,
    live,
    login,
    notes,
    resume() {
      sync.resume();
      void notes.refresh();
      void notes.drain();
      dispatch.resume();
    },
    async start() {
      if (started) {
        return;
      }
      started = true;
      let stored: DeviceCredential | null = null;
      try {
        stored = await args.credentials.read();
      } catch (error) {
        login.fail(
          `The saved sign-in could not be read: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      if (stored === null) {
        sync.setCredential(null);
        return;
      }
      await activate(stored, "restored");
    },
    store,
    submitCapture: createCaptureSender({ mintKey: args.mintId, send: sync.createCapture }),
    suspend() {
      sync.suspend();
      dispatch.suspend();
    },
    sync,
  };
};
