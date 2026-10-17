// the platform-free half of the composition root: app-runtime.ts binds it to the Keychain, the
// database, the attachment and outbox files, SHA-1 and the OS, so every transition between signed
// in and out runs under test, and the scenario suite drives it under node against a real Worker.

import type { ClientBuild } from "@repo/contract/cloud/client-build";
import type { DeviceCredential } from "@repo/contract/cloud/device/device-schema";
import { createDispatchRuntime } from "../dispatch/dispatch-runtime";
import { createItemOps } from "../items/item-ops";
import type { ItemOps } from "../items/item-ops";
import type { DispatchRuntime, DispatchRuntimeArgs } from "../dispatch/dispatch-runtime";
import { createLoginStore } from "../login/login-store";
import type { LoginStore } from "../login/login-store";
import type { AttachmentFiles } from "../notes/attachment-files";
import { createAnnotationOps } from "../notes/annotation-ops";
import type { AnnotationOps } from "../notes/annotation-ops";
import { createFileOps } from "../notes/file-ops";
import type { FileOps } from "../notes/file-ops";
import { createNotesStore } from "../notes/notes-store";
import type { CreateNotesStoreArgs, NotesStore } from "../notes/notes-store";
import type { Sha1 } from "../notes/outbox-ops";
import type { OutboxFiles } from "../notes/outbox-files";
import { createLiveTurns } from "../sync/live-turns";
import type { LiveTurns } from "../sync/live-turns";
import { createSqliteSyncStore } from "../sync/sqlite-sync-store";
import { createSyncRuntime } from "../sync/sync-runtime";
import type { SyncRuntime, SyncRuntimeArgs } from "../sync/sync-runtime";
import type { SyncStore } from "../sync/sync-store";
import { messageOf } from "./error-message";
import type { SignInSource } from "./sign-in-fence";
import type { SqlDriver } from "./sql-driver";

export interface CredentialStore {
  read: () => Promise<DeviceCredential | null>;
  write: (credential: DeviceCredential) => Promise<void>;
  clear: () => Promise<void>;
}

export interface ComposeRuntimeArgs {
  cloudUrl: string;
  build: ClientBuild;
  credentials: CredentialStore;
  // openPhoneDb's, opened once for the app's life; a restore keeps what it holds, every other
  // sign-in wipes it
  db: SqlDriver;
  attachments: AttachmentFiles;
  outboxFiles: OutboxFiles;
  sha1: Sha1;
  deviceName: string;
  mintId: () => string;
  randomBytes: (length: number) => Uint8Array;
  // a uuid: a saved item's id, and a note's for its first annotation
  newId: () => string;
  sync?: Omit<SyncRuntimeArgs, "build" | "cloudUrl" | "onDispatchPing" | "onVaultPing" | "store">;
  retryBaseMs?: CreateNotesStoreArgs["retryBaseMs"];
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
  // saving a link or a thought into Unsorted
  items: ItemOps;
  annotations: AnnotationOps;
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
}

export const composeRuntime = (args: ComposeRuntimeArgs): AppRuntime => {
  const live = createLiveTurns();
  const store = createSqliteSyncStore({ db: args.db, live, sha1: args.sha1 });
  // the pings reach the notes and the dispatch runtimes, which read under the sync runtime's
  // session and so are built after it; bound below, before start() can open the socket
  let pinged: { vault: () => void; dispatch: () => void } | null = null;
  const sync = createSyncRuntime({
    ...args.sync,
    build: args.build,
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
    mintNoteId: args.newId,
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
    client: { baseUrl: args.cloudUrl, build: args.build },
    store: {
      // the bearer alone: nothing the phone runs asks whose account it is
      write: async (answer) => {
        const credential: DeviceCredential = {
          credential: answer.credential,
          deviceId: answer.deviceId,
        };
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
    annotations: createAnnotationOps({
      now: () => Math.floor(Date.now() / 1000),
      randomBytes: args.randomBytes,
      store: notes,
    }),
    fileOps: createFileOps(notes, { now: () => new Date() }),
    items: createItemOps({ newId: args.newId, now: () => new Date(), store: notes }),
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
          `Signed out, but the saved sign-in could not be removed and may return on the next launch: ${messageOf(error)}`,
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
        login.fail(`The saved sign-in could not be read: ${messageOf(error)}`);
      }
      if (stored === null) {
        sync.setCredential(null);
        return;
      }
      await activate(stored, "restored");
    },
    store,
    suspend() {
      sync.suspend();
      dispatch.suspend();
    },
    sync,
  };
};
